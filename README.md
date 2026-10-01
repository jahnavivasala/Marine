MARINE SENTINEL
Privacy-Preserving Maritime Pollution Intelligence
A first-semester CSE prototype for turning a locally supplied satellite image into an explainable maritime-pollution investigation workflow.
Core idea
Marine Sentinel is not positioned as “another oil-spill segmentation demo”. The prototype connects several investigation steps:
Local satellite image → suspected pollution detection → estimated drift trajectory → AIS trajectory correlation → GIS impact assessment → evidence-traceable investigation dossier
Why the workflow matters
A detection mask answers “where might pollution be?” An investigator also needs context: when and where the event may have originated, how it could have moved, which vessel tracks are spatially and temporally consistent with the estimated origin, what sensitive zones may be affected, and which assumptions still require human verification.
Prototype scope
This GitHub version is deliberately self-contained. It uses a deterministic demo analysis so the interface can be demonstrated without external APIs or credentials.
The demo clearly distinguishes:
observed/sample data
model estimates
correlations
human-verification items
The candidate-vessel score is not proof of responsibility.
Standout features
Local-first image workflow: the selected image is processed in the browser for the prototype.
Explainable spill assessment with a confidence band and visible factors.
Drift “backtrace” showing an estimated source corridor rather than only drawing a decorative arrow.
AIS correlation panel ranking sample vessels by trajectory/time consistency.
GIS-style impact layer for coastline, protected area and fishing-zone intersections.
Evidence ledger with source, observation, transformation and verification state.
SHA-256 image fingerprint generated in-browser using Web Crypto when supported.
Investigation dossier preview and printable/exportable report.
Demo-data mode with transparent labels instead of fabricated live telemetry.
Graceful fallback if a sample image is unavailable.
Responsive operational dashboard suitable for a classroom demonstration.
Technology
HTML5
CSS3
Vanilla JavaScript
Browser Canvas API
Web Crypto API
No framework or build step required
Run locally
Open index.html in a modern browser. For the smoothest browser-security behaviour, serve the folder with any simple local HTTP server.
GitHub Pages
This is a static site. Upload the repository and enable GitHub Pages from the repository's Pages settings. No backend is required for the demo.
Data disclaimer
The included vessel/environmental records are demonstration data. They are not live AIS telemetry and must not be treated as operational intelligence.
Legal / operational disclaimer
Marine Sentinel is an academic prototype. It does not establish causation, identify a legally responsible party, or produce automatically admissible evidence. Candidate-vessel correlations are intended for analyst review.
Future engineering path
Replace demo spill scoring with a validated segmentation model.
Connect authorised satellite sources.
Connect approved ocean-current and wind feeds.
Integrate an authorised AIS provider.
Add geospatial libraries and authoritative boundary datasets.
Add analyst authentication, audit logs and secure storage.
Validate against labelled historical spill events.
Conduct domain and legal review before operational use.
Demo story
Load the included demonstration scene.
Show the suspected-pollution mask and confidence.
Open Drift & Origin to show the estimated source corridor.
Open Vessel Correlation and explain that AIS provides consistency evidence, not proof.
Open Impact Map to show affected sensitive zones.
Open Evidence Ledger to show provenance and verification state.
Export the investigation dossier.
Suggested presentation line
“We are not trying to make a black-box system declare who is guilty. We are building an explainable investigation layer that connects remote-sensing observations, movement evidence and geographic impact into one reviewable workflow.”
v3 upgrade: real analysis engine (engine.js)
Aligned with SIH26143 (NTRO): satellite oil-spill detection + AIS correlation to identify the responsible vessel.
Step
What now actually runs (in the browser)
Detect
Local-contrast dark-patch detection + connected components on any uploaded image
Classify
Shape/contrast heuristic: likely mineral oil vs. look-alike (low-wind / algal)
Area
Pixel count x editable m/px resolution -> km²
Backtrace
Current + 3% wind drift, uncertainty growing with spill age; editable wind, current, age
Correlate
AIS tracks interpolated to estimated release time, scored by distance to origin; flags AIS dark periods (possible switch-off)
Assess
12 h forecast path tested against protected / fishing / coastal zones, with hours-to-impact
Package
Dossier (.txt), machine-readable JSON, annotated PNG, print view
Honest limits
Detection is a heuristic, not a trained model. Next step: a U-Net trained on Sentinel-1 SAR (e.g. public oil-spill datasets).
AIS tracks (data.js) and GIS zones are sample data. Next step: real AIS feed/CSV and real shapefiles.
Drift uses user-set wind/current. Next step: Copernicus Marine / ERA5 fields.
v4 additions
Real AIS CSV upload (name,mmsi,type,time_utc,lat,lon): positions are georeferenced to the scene (centre lat/lon + m/px + capture time); AIS silences > 1.5 h are auto-flagged as dark periods. Template download included.
Scenario presets, detection-sensitivity control, exposed GIS zones highlighted, keyboard-accessible upload, SIH26143 badge.
Input validation (v5): colour/false-colour products such as InSAR interferograms are rejected as unsuitable; no-data/radar-shadow black regions and water-body-sized dark areas are no longer reported as slicks. Confidence capped at 88% (heuristic).
Real-SAR tuning (v6): tested on a real greyscale SAR scene with land, ships and several slicks. Land is masked out of the background estimate, speckle is smoothed, up to 8 slicks are mapped (area = total), and dark patches touching land are labelled coastal look-alikes and ranked lower.
