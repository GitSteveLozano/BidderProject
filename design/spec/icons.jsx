/* Icons — simple stroke-line set, sized 16 by default */

const Ic = ({ size = 16, stroke = 1.5, className = "", children, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={stroke}
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    {children}
  </svg>
);

const IcPlus = (p) => <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>;
const IcCheck = (p) => <Ic {...p}><path d="M5 12l5 5L20 7" /></Ic>;
const IcX = (p) => <Ic {...p}><path d="M6 6l12 12M6 18L18 6" /></Ic>;
const IcArrowRight = (p) => <Ic {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Ic>;
const IcArrowLeft = (p) => <Ic {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Ic>;
const IcArrowUpRight = (p) => <Ic {...p}><path d="M7 17 17 7M8 7h9v9" /></Ic>;
const IcChevronDown = (p) => <Ic {...p}><path d="M6 9l6 6 6-6" /></Ic>;
const IcChevronRight = (p) => <Ic {...p}><path d="M9 6l6 6-6 6" /></Ic>;
const IcSearch = (p) => <Ic {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Ic>;
const IcDashboard = (p) => <Ic {...p}><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></Ic>;
const IcQuote = (p) => <Ic {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></Ic>;
const IcJob = (p) => <Ic {...p}><path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/></Ic>;
const IcClient = (p) => <Ic {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></Ic>;
const IcSettings = (p) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ic>;
const IcUpload = (p) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></Ic>;
const IcFile = (p) => <Ic {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></Ic>;
const IcMic = (p) => <Ic {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></Ic>;
const IcKeyboard = (p) => <Ic {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></Ic>;
const IcSparkle = (p) => <Ic {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></Ic>;
const IcZap = (p) => <Ic {...p}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></Ic>;
const IcSend = (p) => <Ic {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></Ic>;
const IcMail = (p) => <Ic {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Ic>;
const IcPhone = (p) => <Ic {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z"/></Ic>;
const IcDollar = (p) => <Ic {...p}><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></Ic>;
const IcClock = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Ic>;
const IcCalendar = (p) => <Ic {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></Ic>;
const IcLayers = (p) => <Ic {...p}><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></Ic>;
const IcTrending = (p) => <Ic {...p}><path d="M3 17 9 11l4 4 8-8M14 7h7v7"/></Ic>;
const IcTrendingDn = (p) => <Ic {...p}><path d="M3 7l6 6 4-4 8 8M14 17h7v-7"/></Ic>;
const IcMinus = (p) => <Ic {...p}><path d="M5 12h14"/></Ic>;
const IcMore = (p) => <Ic {...p}><circle cx="12" cy="12" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Ic>;
const IcEye = (p) => <Ic {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Ic>;
const IcEdit = (p) => <Ic {...p}><path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></Ic>;
const IcCopy = (p) => <Ic {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Ic>;
const IcLock = (p) => <Ic {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Ic>;
const IcLink = (p) => <Ic {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></Ic>;
const IcInfo = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></Ic>;
const IcAlert = (p) => <Ic {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></Ic>;
const IcMapPin = (p) => <Ic {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></Ic>;
const IcUsers = (p) => <Ic {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></Ic>;
const IcGrid = (p) => <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Ic>;
const IcCircleCheck = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></Ic>;
const IcWand = (p) => <Ic {...p}><path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1zM21 12l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5zM3 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM6 17l13-13"/></Ic>;
const IcTag = (p) => <Ic {...p}><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/></Ic>;
const IcDownload = (p) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></Ic>;
const IcRefresh = (p) => <Ic {...p}><path d="M21 12a9 9 0 1 1-3-6.74L21 8M21 3v5h-5"/></Ic>;

Object.assign(window, {
  IcPlus, IcCheck, IcX, IcArrowRight, IcArrowLeft, IcArrowUpRight,
  IcChevronDown, IcChevronRight, IcSearch, IcDashboard, IcQuote, IcJob,
  IcClient, IcSettings, IcUpload, IcFile, IcMic, IcKeyboard, IcSparkle,
  IcZap, IcSend, IcMail, IcPhone, IcDollar, IcClock, IcCalendar,
  IcLayers, IcTrending, IcTrendingDn, IcMinus, IcMore, IcEye, IcEdit,
  IcCopy, IcLock, IcLink, IcInfo, IcAlert, IcMapPin, IcUsers, IcGrid,
  IcCircleCheck, IcWand, IcTag, IcDownload, IcRefresh,
});
