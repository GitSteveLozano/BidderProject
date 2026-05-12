/** @jsxImportSource react */
/**
 * BidPdf — declarative bid document for @react-pdf/renderer.
 *
 * The PDF is the deliverable to the contractor's client, so it has to
 * look polished. Layout (per design/spec/screens.md → Quote production
 * step 5):
 *   - Header: shop legal name, license, date, quote ref
 *   - Client block
 *   - Scope summary (paragraph)
 *   - Line items table (auto-paginates across pages)
 *   - Totals
 *   - Boilerplate intro + closing
 *   - Footer with license number on every page
 *
 * The /** @jsxImportSource react *\/ pragma above is load-bearing —
 * the rest of the app uses Solid's JSX, but @react-pdf/renderer needs
 * React's JSX runtime for THIS file.
 *
 * Components are cast to `any` because @react-pdf/renderer's type
 * exports conflict with Solid's JSX namespace at the project tsconfig
 * level. Runtime is unaffected; this is purely a typecheck-time cast.
 */
import {
  Document as _Document,
  Page as _Page,
  Text as _Text,
  View as _View,
  StyleSheet,
} from '@react-pdf/renderer';

const Document = _Document as any;
const Page = _Page as any;
const Text = _Text as any;
const View = _View as any;

interface BidProps {
  ref?: string;
  date?: string;
  client_name?: string;
  client_contact?: string;
  client_address?: string;
  project_title?: string;
  project_address?: string;
  scope_summary?: string;
  line_items: Array<{
    description: string;
    qty: number;
    unit?: string;
    unit_price: number;
    subtotal: number;
    category?: string;
  }>;
  total: number;
  shop?: {
    legal_name?: string;
    trade_name?: string;
    license_number?: string;
    license_jurisdiction?: string;
    boilerplate_intro?: string;
    boilerplate_closing?: string;
    owner_name?: string;
    owner_email?: string;
  };
}

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#fdfbf6',
    padding: 56,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1c1a16',
  },
  header: {
    marginBottom: 28,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1a16',
    borderBottomStyle: 'solid',
  },
  shopName: {
    fontFamily: 'Times-Roman',
    fontSize: 22,
    letterSpacing: -0.3,
  },
  shopMeta: {
    color: '#6b6358',
    fontSize: 9,
    marginTop: 4,
  },
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    fontSize: 9,
  },
  refLabel: { color: '#6b6358' },
  refValue: { fontFamily: 'Courier' },
  sectionTitle: {
    fontFamily: 'Times-Roman',
    fontSize: 14,
    marginTop: 12,
    marginBottom: 8,
  },
  clientGrid: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 20,
  },
  clientCol: { flex: 1 },
  fieldLabel: {
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#918a7d',
    marginBottom: 2,
  },
  fieldValue: { fontSize: 10 },
  scopeBody: {
    fontFamily: 'Times-Roman',
    fontSize: 11,
    lineHeight: 1.5,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    paddingTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1a16',
    borderBottomStyle: 'solid',
    fontSize: 8,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#6b6358',
  },
  tableRow: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#efe9dc',
    borderBottomStyle: 'solid',
  },
  tableDesc: { flex: 4 },
  tableQty: { flex: 1, textAlign: 'right' },
  tableUnit: { flex: 1, textAlign: 'right', color: '#6b6358' },
  tableUnitPrice: { flex: 1.2, textAlign: 'right' },
  tableSubtotal: { flex: 1.4, textAlign: 'right' },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 14,
    marginTop: 6,
    borderTopWidth: 1.5,
    borderTopColor: '#1c1a16',
    borderTopStyle: 'solid',
  },
  totalLabel: { fontSize: 10, color: '#6b6358', marginRight: 16 },
  totalValue: {
    fontFamily: 'Times-Roman',
    fontSize: 18,
    letterSpacing: -0.3,
  },
  boilerplate: {
    fontFamily: 'Times-Roman',
    fontSize: 11,
    lineHeight: 1.5,
    marginTop: 20,
    color: '#2d2a23',
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 56,
    right: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: '#918a7d',
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#efe9dc',
    borderTopStyle: 'solid',
  },
});

function fmt(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BidPdf(props: BidProps) {
  const shop = props.shop ?? {};
  const ref = props.ref ?? 'Q-DRAFT';
  const date = props.date ?? new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <Document title={`Bid · ${props.client_name ?? ''} · ${ref}`} author={shop.legal_name ?? 'Brief'}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.shopName}>{shop.trade_name || shop.legal_name || ''}</Text>
          <Text style={styles.shopMeta}>
            {[shop.license_number, shop.license_jurisdiction].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.refRow}>
            <Text>
              <Text style={styles.refLabel}>Date: </Text>
              <Text>{date}</Text>
            </Text>
            <Text>
              <Text style={styles.refLabel}>Quote: </Text>
              <Text style={styles.refValue}>{ref}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.clientGrid}>
          <View style={styles.clientCol}>
            <Text style={styles.fieldLabel}>For</Text>
            <Text style={styles.fieldValue}>{props.client_name ?? ''}</Text>
            {props.client_contact && (
              <Text style={styles.fieldValue}>{props.client_contact}</Text>
            )}
            {props.client_address && (
              <Text style={[styles.fieldValue, { color: '#6b6358' }]}>{props.client_address}</Text>
            )}
          </View>
          <View style={styles.clientCol}>
            <Text style={styles.fieldLabel}>Project</Text>
            <Text style={styles.fieldValue}>{props.project_title ?? ''}</Text>
            {props.project_address && (
              <Text style={[styles.fieldValue, { color: '#6b6358' }]}>{props.project_address}</Text>
            )}
          </View>
        </View>

        {shop.boilerplate_intro && (
          <Text style={styles.boilerplate}>{shop.boilerplate_intro}</Text>
        )}

        {props.scope_summary && (
          <View>
            <Text style={styles.sectionTitle}>Scope</Text>
            <Text style={styles.scopeBody}>{props.scope_summary}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Line items</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.tableDesc}>Description</Text>
          <Text style={styles.tableQty}>Qty</Text>
          <Text style={styles.tableUnit}>Unit</Text>
          <Text style={styles.tableUnitPrice}>Unit price</Text>
          <Text style={styles.tableSubtotal}>Subtotal</Text>
        </View>
        {props.line_items.map((li, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={styles.tableDesc}>{li.description}</Text>
            <Text style={styles.tableQty}>{li.qty.toLocaleString()}</Text>
            <Text style={styles.tableUnit}>{li.unit ?? ''}</Text>
            <Text style={styles.tableUnitPrice}>{fmt(li.unit_price)}</Text>
            <Text style={styles.tableSubtotal}>{fmt(li.subtotal)}</Text>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{fmt(props.total)}</Text>
        </View>

        {shop.boilerplate_closing && (
          <Text style={styles.boilerplate}>{shop.boilerplate_closing}</Text>
        )}

        <View style={styles.footer} fixed>
          <Text>{shop.legal_name ?? ''}</Text>
          <Text>
            {shop.license_number ? `${shop.license_number} · ${shop.license_jurisdiction ?? ''}` : ''}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
