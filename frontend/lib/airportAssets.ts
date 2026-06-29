export interface AirportReportAsset {
  label: string;
  publicPath: string;
  sourceUrl: string;
  sourceName: string;
  retrievedAt: string;
  licenseNote?: string;
}

export interface AirportReportAssets {
  logo?: AirportReportAsset;
  terminalMap?: AirportReportAsset;
  airportDiagram?: AirportReportAsset;
}

export const AIRPORT_ASSETS_BY_CODE: Record<string, AirportReportAssets> = {
  AGS: {
    logo: {
      label: "AGS official color logo",
      publicPath: "/airports/ags/ags-logo-color.png",
      sourceUrl: "https://flyags.com/",
      sourceName: "Augusta Regional Airport",
      retrievedAt: "2026-06-29",
      licenseNote: "Official AGS website asset; use with airport/customer permission for external reports.",
    },
    terminalMap: {
      label: "AGS terminal map",
      publicPath: "/airports/ags/ags-terminal-map.jpeg",
      sourceUrl: "https://flyags.com/travelers/while-youre-here/terminal-map/",
      sourceName: "Augusta Regional Airport terminal map",
      retrievedAt: "2026-06-29",
      licenseNote: "Official AGS website asset; use with airport/customer permission for external reports.",
    },
    airportDiagram: {
      label: "KAGS FAA airport diagram",
      publicPath: "/airports/ags/kags-airport-diagram-faa-2026-06.pdf",
      sourceUrl: "http://aeronav.faa.gov/d-tpp/2606/00027AD.PDF",
      sourceName: "FAA Digital Terminal Procedures Publications",
      retrievedAt: "2026-06-29",
      licenseNote: "FAA airport diagram reference; not for navigation.",
    },
  },
};

export const getAirportReportAssets = (code?: string): AirportReportAssets | undefined =>
  code ? AIRPORT_ASSETS_BY_CODE[code.toUpperCase()] : undefined;
