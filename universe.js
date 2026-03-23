/**
 * Stock Universe — Hardcoded S&P 500 + popular stocks & ETFs
 * Used as fallback when Finnhub dynamic fetch fails
 * Referenced by advisor.js screener functions
 */
var BUILTIN_STOCKS = [
  'AAPL','MSFT','AMZN','NVDA','GOOGL','GOOG','META','BRK.B','TSLA','UNH',
  'XOM','JNJ','JPM','V','PG','MA','AVGO','HD','CVX','MRK',
  'LLY','ABBV','PEP','KO','COST','ADBE','WMT','MCD','CSCO','CRM',
  'ACN','TMO','ABT','DHR','LIN','NKE','NFLX','AMD','TXN','PM',
  'NEE','UNP','RTX','ORCL','HON','LOW','UPS','QCOM','INTC','INTU',
  'AMGN','SBUX','BA','GS','CAT','BLK','ISRG','MDLZ','ADP','GILD',
  'DE','BKNG','VRTX','SYK','ADI','MMC','REGN','LRCX','PLD','CB',
  'TMUS','CI','SCHW','ZTS','MO','SO','DUK','BDX','CME','PYPL',
  'CL','EQIX','ITW','SLB','AON','ICE','NOC','APD','SHW','SNPS',
  'CDNS','MCK','FDX','PNC','TGT','EMR','ORLY','GD','MPC','AJG',
  'PSX','TFC','ANET','KLAC','AZO','MNST','ADSK','FTNT','KMB','AEP',
  'D','SRE','MCHP','MSCI','PAYX','WELL','HUM','CTAS','DXCM','ROP',
  'IDXX','PCAR','GIS','AIG','AFL','WMB','TRV','FAST','YUM','CTSH',
  'BK','VRSK','HSY','ODFL','EW','CPRT','BIIB','ON','GEHC','FANG',
  'FICO','MPWR','AXON','DECK','IT','CSGP','GWW','URI','ANSS','KEYS',
  'CDW','ROK','TSCO','TRGP','EFX','DOV','WAT','HUBB','BR','STE',
  'WST','TDY','FTV','ZBRA','POOL','TECH','TER','ALGN','PTC','NDSN',
  'WEC','ES','AEE','CMS','LNT','EVRG','DTE','XEL','FE','PPL',
  'ED','AWK','ETR','ATO','NI','PNW','OGE','CNP','NRG','CEG',
  'CARR','OTIS','IEX','NDAQ','CBOE','MKTX','TW','FDS','MSCI','SPGI',
  'MCO','CPAY','GPN','FIS','FISV','AXP','COF','DFS','SYF','ALLY',
  'WFC','BAC','C','USB','PNC','TFC','FITB','HBAN','KEY','RF',
  'CFG','MTB','ZION','CMA','SIVB','SCHW','NTRS','STT','BK','BEN',
  'IVZ','TROW','AMG','EV','SEIC','APAM','VCIT','LM','JHG','FHI',
  'PFE','BMY','LLY','MRK','ABBV','AMGN','GILD','REGN','VRTX','BIIB',
  'MRNA','ILMN','DXCM','ISRG','SYK','BDX','ZBH','BSX','MDT','EW',
  'ABT','TMO','DHR','A','WAT','MTD','TECH','BIO','PKI','HOLX',
  'DIS','CMCSA','NFLX','CHTR','PARA','WBD','FOX','FOXA','NWS','NWSA',
  'T','VZ','TMUS','LUMN','DISH','SIRI','ROKU','SPOT','TTD','PINS',
  'SNAP','UBER','LYFT','ABNB','DASH','COIN','SQ','SHOP','MELI','SE',
  'BABA','JD','PDD','BIDU','NIO','LI','XPEV','RIVN','LCID','FSR',
  'F','GM','TM','HMC','STLA','RACE','TSLA','NIO','RIVN','LCID',
  'COP','EOG','PXD','DVN','FANG','HES','OXY','MRO','APA','HAL',
  'SLB','BKR','VLO','MPC','PSX','DINO','PBF','HFC','DK','CVI',
  'LMT','RTX','NOC','GD','BA','LHX','HII','TDG','HWM','TXT',
  'SPR','ERJ','AXON','LDOS','SAIC','BAH','CACI','KBR','PSN','HXL',
  'PANW','CRWD','ZS','FTNT','CYBR','OKTA','NET','S','TENB','QLYS',
  'NOW','SNOW','DDOG','MDB','ESTC','CFLT','PATH','AI','PLTR','PALANTIR',
  'WDAY','VEEV','HUBS','ZM','DOCU','BILL','PCTY','PAYC','WK','APPN',
  'ARM','SMCI','MRVL','MU','LRCX','KLAC','AMAT','ASML','TSM','SNPS',
  'CDNS','ANSS','SWKS','QRVO','MCHP','NXPI','TXN','ADI','MPWR','ON'
];
var BUILTIN_ETFS = [
  'SPY','QQQ','IWM','DIA','VOO','VTI','VEA','VWO','EFA','EEM',
  'AGG','BND','TLT','IEF','SHY','LQD','HYG','JNK','TIP','VTIP',
  'GLD','SLV','IAU','GLDM','PDBC','DBC','USO','UNG','WEAT','CORN',
  'XLF','XLK','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE',
  'XLC','VGT','VHT','VFH','VIS','VCR','VDC','VPU','VAW','VNQ',
  'ARKK','ARKW','ARKG','ARKF','ARKQ','ARKX','HACK','BOTZ','ROBO','IRBO',
  'SOXX','SMH','XSD','SOXL','SOXS','TQQQ','SQQQ','SPXL','SPXS','UPRO',
  'VIG','VYM','SCHD','DVY','HDV','DGRO','NOBL','SDY','SPYD','JEPI',
  'IBIT','BITO','GBTC','ETHE','MSTR','COIN','BITQ','WGMI','DAPP','BLOK',
  'RSP','QUAL','MTUM','VLUE','SIZE','USMV','SPLV','MOAT','COWZ','DIVO'
];

// Build universe from hardcoded lists (fallback)
