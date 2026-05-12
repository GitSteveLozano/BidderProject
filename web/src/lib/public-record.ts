/**
 * Public-record lookup — fetches what we can about a shop from public
 * sources without an API key gate. Two paths:
 *
 *   1. Website meta extraction (HTML fetch + parse og:tags, JSON-LD
 *      Organization schema, address blocks, license-number patterns
 *      in the footer). Reliable across shops because most contractors
 *      have a site.
 *
 *   2. State contractor-license lookup. Implemented as a registry so
 *      we can add states one at a time. Today: California CSLB
 *      (HTML search-results page). Hawaii DCCA and others can be
 *      bolted on the same shape.
 *
 * All scrapers return `null` rather than throwing — we want partial
 * results to flow through to the onboarding UI so the operator sees
 * "here's what we found" instead of "lookup failed."
 */

export interface PublicRecordMatch {
  source: 'website' | 'cslb' | 'hi-dcca';
  source_label: string;
  legal_name?: string;
  trade_name?: string;
  license_number?: string;
  license_classification?: string;
  license_jurisdiction?: string;
  license_expires?: string;
  status?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  evidence_url: string;
  evidence_excerpt?: string;
}

export interface LookupInput {
  business_name?: string;
  state?: string;
  website_url?: string;
}

export async function publicRecordLookup(
  input: LookupInput,
): Promise<PublicRecordMatch[]> {
  const matches: PublicRecordMatch[] = [];

  if (input.website_url) {
    const m = await fromWebsite(input.website_url);
    if (m) matches.push(m);
  }

  if (input.business_name && input.state) {
    const state = input.state.trim().toUpperCase();
    if (state === 'CA') {
      const m = await fromCSLB(input.business_name);
      if (m) matches.push(m);
    } else if (state === 'HI') {
      const m = await fromHawaiiDCCA(input.business_name);
      if (m) matches.push(m);
    }
  }

  return matches;
}

// ─── Website meta ────────────────────────────────────────────────

async function fromWebsite(rawUrl: string): Promise<PublicRecordMatch | null> {
  let url: URL;
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }

  const resp = await fetch(url.toString(), {
    headers: {
      'user-agent': 'BriefBot/1.0 (+https://brief.app)',
      accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const html = (await resp.text()).slice(0, 200_000);

  const ogSiteName = pickMeta(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle = pickMeta(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = pickMeta(html, /<title[^>]*>([^<]+)<\/title>/i);
  const description = pickMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  const orgJsonLd = pickJsonLd(html, 'Organization') ?? pickJsonLd(html, 'LocalBusiness');
  const license = pickLicenseNumber(html);
  const phone = pickPhone(html);
  const email = pickEmail(html);
  const address = orgJsonLd?.address
    ? formatJsonLdAddress(orgJsonLd.address)
    : pickAddress(html);

  const legal_name = orgJsonLd?.legalName ?? orgJsonLd?.name ?? ogSiteName ?? ogTitle ?? title;
  if (!legal_name && !license && !address) return null;

  return {
    source: 'website',
    source_label: url.hostname,
    legal_name: legal_name?.trim(),
    trade_name: orgJsonLd?.alternateName ?? ogSiteName ?? undefined,
    license_number: license?.number,
    license_classification: license?.classification,
    license_jurisdiction: license?.state,
    address: address ?? undefined,
    phone: phone ?? undefined,
    email: email ?? undefined,
    website: url.origin,
    evidence_url: url.toString(),
    evidence_excerpt: description ?? undefined,
  };
}

function pickMeta(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : undefined;
}

function pickJsonLd(html: string, type: string): any | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const t = item['@type'];
        if (t === type || (Array.isArray(t) && t.includes(type))) return item;
      }
    } catch {
      // bad JSON-LD blob, keep scanning
    }
  }
  return null;
}

function formatJsonLdAddress(addr: any): string | undefined {
  if (!addr) return undefined;
  if (typeof addr === 'string') return addr;
  const parts = [
    addr.streetAddress,
    [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '),
    addr.postalCode,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function pickLicenseNumber(html: string): { number: string; classification?: string; state?: string } | undefined {
  // California: "License #1089342" or "CSLB #1089342" or "C-35 #1089342"
  const cslb = html.match(/(?:CSLB|License|Lic\.?|License #?)[\s:]*#?\s*(\d{6,8})/i);
  if (cslb) {
    const cls = html.match(/\b(C-\d{1,3}|B|A)\s*(?:License|Class)?\b/);
    return { number: cslb[1], classification: cls?.[1], state: undefined };
  }
  // Hawaii contractor: CT-12345, BC-12345, etc.
  const hi = html.match(/\b(CT|BC|MC|EC|SC|RC)[\s-]?(\d{4,6})\b/);
  if (hi) return { number: `${hi[1]}-${hi[2]}`, state: 'HI' };
  return undefined;
}

function pickPhone(html: string): string | undefined {
  const m = html.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return m?.[1];
}

function pickEmail(html: string): string | undefined {
  const m = html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  // Filter out common false positives (image hashes, etc).
  if (!m) return undefined;
  const email = m[0];
  if (email.length > 80) return undefined;
  if (email.endsWith('.png') || email.endsWith('.jpg')) return undefined;
  return email;
}

function pickAddress(html: string): string | undefined {
  // Look for a street + city + state pattern in plain text.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = stripped.match(/(\d{2,5} [A-Z][A-Za-z. ]+(?: (?:St|Ave|Blvd|Rd|Dr|Hwy|Way|Ln|Pl|Ct)\.?)),\s*([A-Z][A-Za-z .]+),\s*([A-Z]{2})\s+(\d{5})/);
  if (m) return `${m[1]}, ${m[2]}, ${m[3]} ${m[4]}`;
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// ─── California CSLB ──────────────────────────────────────────────
// The public license search at cslb.ca.gov has its own HTML format.
// We post the business name and parse the results page. The endpoint
// is form-encoded and returns a list of licensees as an HTML table.
// Best-effort: the page changes occasionally; if parsing fails we
// just return null and the website match still flows through.

async function fromCSLB(businessName: string): Promise<PublicRecordMatch | null> {
  const url = `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseSearch.aspx?BusName=${encodeURIComponent(businessName)}`;
  const resp = await fetch(url, {
    headers: {
      'user-agent': 'BriefBot/1.0 (+https://brief.app)',
      accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const html = (await resp.text()).slice(0, 400_000);

  // Look for the first license row: license number + business name + class.
  // CSLB's table layout is roughly: <td>License #</td><td>Name</td>...
  const row = html.match(
    /(?:License|Lic)[\s\S]{0,100}?(\d{6,8})[\s\S]{0,200}?<\/?\w+[^>]*>\s*([^<]+?)\s*<[\s\S]{0,500}?\b(C-\d{1,3}|B|A)\b/i,
  );
  if (!row) return null;
  return {
    source: 'cslb',
    source_label: 'CSLB (California Contractors State License Board)',
    legal_name: row[2].trim(),
    license_number: row[1],
    license_classification: row[3],
    license_jurisdiction: 'CA',
    evidence_url: url,
    evidence_excerpt: `CSLB license #${row[1]} · ${row[3]}`,
  };
}

// ─── Hawaii DCCA ──────────────────────────────────────────────────
// Hawaii's Professional and Vocational Licensing (PVL) public search
// at pvl.ehawaii.gov/pvlsearch. Same shape as CSLB — parse the
// licensee row if the page returns one.

async function fromHawaiiDCCA(businessName: string): Promise<PublicRecordMatch | null> {
  const url = `https://pvl.ehawaii.gov/pvlsearch/businessresults?keyword=${encodeURIComponent(businessName)}`;
  const resp = await fetch(url, {
    headers: {
      'user-agent': 'BriefBot/1.0 (+https://brief.app)',
      accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const html = (await resp.text()).slice(0, 400_000);

  const row = html.match(/\b((?:CT|BC|MC|EC|SC|RC)[\s-]?\d{4,6})\b[\s\S]{0,300}?>\s*([^<]+?)\s*</);
  if (!row) return null;
  return {
    source: 'hi-dcca',
    source_label: 'Hawaii DCCA / PVL',
    legal_name: row[2].trim(),
    license_number: row[1].replace(/\s/g, ''),
    license_jurisdiction: 'HI',
    evidence_url: url,
    evidence_excerpt: `Hawaii PVL license ${row[1]}`,
  };
}
