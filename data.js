const DEMO_DATA = {
  caseId: "MS-DEMO-014",
  sceneName: "Arabian Sea / Demonstration Scene",
  detection: { confidence: 94, area: "12.6 km²", window: "18:20–21:10 UTC" },
  params: { sens: 1, lat: 15.5, lon: 68, res: 40, age: 3.5, wind: 6, windDir: 300, cur: 0.4, curDir: 120 },
  presets: {
    "Fresh spill (2 h)": { age: 2, wind: 5, cur: 0.3 },
    "Old spill, strong current (6 h)": { age: 6, wind: 8, cur: 0.7, curDir: 100 },
    "Storm windage": { age: 4, wind: 14, windDir: 250, cur: 0.3 }
  },
  zones: [
    {name:"Protected: Marine reserve A", type:"protected", r:[0.05,0.2,0.22,0.45]},
    {name:"Protected: Coral shelf B", type:"protected", r:[0.80,0.60,0.96,0.78]},
    {name:"Fishing: Ground 1", type:"fishing", r:[0.70,0.70,0.90,0.92]},
    {name:"Fishing: Ground 2", type:"fishing", r:[0.30,0.60,0.50,0.85]},
    {name:"Fishing: Ground 3", type:"fishing", r:[0.00,0.50,0.15,0.75]},
    {name:"Coast: Segment N1", type:"coast", r:[0.00,0.00,0.35,0.12]},
    {name:"Coast: Segment N2", type:"coast", r:[0.35,0.00,0.70,0.12]},
    {name:"Coast: Segment N3", type:"coast", r:[0.70,0.00,0.90,0.12]},
    {name:"Coast: Segment E4", type:"coast", r:[0.97,0.30,1.00,0.80]}
  ],
  vessels: [
    {name:"MV Nereid", type:"Product tanker", mmsi:"Demo-AIS-001", track:[[8,0.30,0.70],[3.6,0.58,0.54],[0,0.88,0.30]]},
    {name:"Ocean Crest", type:"Container vessel", mmsi:"Demo-AIS-002", track:[[8,0.35,0.30],[3.6,0.62,0.42],[0,0.95,0.55]]},
    {name:"Sea Meridian", type:"Bulk carrier", mmsi:"Demo-AIS-003", track:[[8,0.10,0.15],[3.6,0.20,0.20],[0,0.30,0.25]]},
    {name:"Pacific Dawn", type:"Chemical tanker", mmsi:"Demo-AIS-004", track:[[8,0.45,0.85],[4.6,0.55,0.62],[2.6,0.60,0.50],[0,0.90,0.90]], gap:[4.6,2.6]}
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
