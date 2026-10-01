const DEMO_DATA = {
  caseId: "MS-DEMO-014",
  sceneName: "Arabian Sea / Demonstration Scene",
  detection: { confidence: 94, area: "12.6 km²", window: "18:20–21:10 UTC" },
  vessels: [
    {name:"MV Nereid", type:"Product tanker", mmsi:"Demo-AIS-001", score:87, detail:"Strong spatial + temporal consistency"},
    {name:"Ocean Crest", type:"Container vessel", mmsi:"Demo-AIS-002", score:61, detail:"Partial corridor overlap"},
    {name:"Sea Meridian", type:"Bulk carrier", mmsi:"Demo-AIS-003", score:34, detail:"Weak temporal consistency"}
  ],
  ledger: [
    ["Source image","Locally supplied satellite scene","OBSERVED","cyan"],
    ["Image fingerprint","SHA-256 generated in browser","TRACEABLE","cyan"],
    ["Pollution mask","Suspected surface anomaly","MODEL ESTIMATE","amber"],
    ["Drift corridor","Estimated from demonstration current field","MODEL ESTIMATE","amber"],
    ["AIS candidates","Sample trajectory correlation","CORRELATION","amber"],
    ["GIS exposure","Protected/fishing/coastal overlays","SPATIAL ANALYSIS","cyan"]
  ]
};
