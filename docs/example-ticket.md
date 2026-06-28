A realistic runway-inspection maintenance ticket should look like a formal airfield work order: it needs to capture the exact location, defect type, safety impact, operational restriction, required response, and any follow-up like NOTAMs, photos, or closure status. The ticket should read like something an airport operations or pavement maintenance team could actually action the same shift, because airport guidance emphasizes prompt removal of debris/contaminants and timely repair of pavement distress to prevent FOD and preserve runway friction. [gcaa.gov](https://www.gcaa.gov.ae/en/epublication/EPublications/Standalone%20AMC/AMC%20-%2036%20-%20RUNWAY%20AND%20MOVEMENT%20AREA%20INSPECTIONS%20-%20ISSUE%2002.pdf)

## What the ticket must contain

Airport guidance points to a few core data elements that matter operationally: the defect’s exact location on the movement area, the type of distress or contamination, whether it creates an immediate hazard, and what corrective action is needed. FAA pavement guidance also stresses that maintenance should be tied to preserving friction, eliminating FOD, and documenting inspection findings for repair planning. [faa](https://www.faa.gov/documentLibrary/media/Advisory_Circular/draft-150-5200-30D-Chg2.pdf)

A realistic ticket usually includes:
- Airport and runway identifier.
- Inspection date/time and inspector.
- Exact location using runway designators, thirds, distance from threshold, centerline/edge reference, and GPS if available.
- Defect category, such as crack, spall, pothole, FOD, rubber buildup, drainage issue, or light/sign damage.
- Severity and operational impact, including whether the runway can stay open, needs a speed restriction, or needs a closure.
- Immediate containment actions already taken.
- Required maintenance task, materials, and priority.
- Photos, sketch, and linked NOTAM or radio/ATC coordination if needed.
- Closeout fields for repair completion and re-inspection. [gcaa.gov](https://www.gcaa.gov.ae/en/epublication/EPublications/Standalone%20AMC/AMC%20-%2036%20-%20RUNWAY%20AND%20MOVEMENT%20AREA%20INSPECTIONS%20-%20ISSUE%2002.pdf)

## Real-life ticket template

Here is a **1:1-style** work order format that is close to how an airport CMMS/EAM ticket would be written:

| Field | Example value |
|---|---|
| Ticket ID | RWY-2026-06-27-0148 |
| Airport | SFO |
| Area | Air Operations Area / Movement Area |
| Asset Type | Runway pavement |
| Runway | RWY 28R |
| Location | Touchdown zone, left of centerline, approx. 1,850 ft from threshold, between taxiway entry A and marking panel 8 |
| Inspection Type | Scheduled daylight runway inspection |
| Discovered By | Airfield Operations Inspector |
| Discovery Time | 2026-06-27 16:42 PDT |
| Defect Type | PCC spall with loose concrete |
| Severity | High |
| Hazard Type | FOD / potential tire damage / debris ingestion |
| Operational Status | Runway remains open with caution; immediate cleanup required |
| Immediate Action Taken | Loose fragments removed; area coned and marked; operations notified |
| Work Required | Vacuum sweep, remove remaining loose material, saw-cut and patch spall, seal joint if needed |
| Priority | P1 - same shift |
| Requested By | Airport Operations |
| Assigned To | Airfield Pavement Maintenance |
| Due | Before next departure bank / within 2 hours |
| Attachments | 3 photos, location sketch, inspector notes |
| Closure Criteria | No loose material, patch complete, supervisor re-inspection passed |
| Related Items | Possible FOD report; evaluate adjacent joints for similar distress |

## Example ticket text

**Work Order: RWY-2026-06-27-0148**  
During the scheduled runway inspection, a concrete spall with loose fragments was identified in the touchdown zone of Runway 28R, approximately 1,850 feet from the threshold, left of centerline. Loose concrete pieces were found on the surface and removed immediately. The condition presents a FOD hazard and could damage aircraft tires or engines if left uncorrected. Maintenance is requested to vacuum sweep the area, remove remaining loose material, and perform a permanent patch repair as soon as possible. This item is high priority and should be completed this shift. Photos and location sketch attached. [faa](https://www.faa.gov/documentLibrary/media/Advisory_Circular/draft-150-5200-30D-Chg2.pdf)

## Fields that make it operationally realistic

In practice, the most useful ticket fields are the ones that let maintenance act without asking follow-up questions. FAA guidance on pavement maintenance and inspection emphasizes identifying the distress, its cause, and the corrective action, while airport FOD guidance emphasizes fast detection, removal, and evaluation of hazards. [gcaa.gov](https://www.gcaa.gov.ae/en/epublication/EPublications/Standalone%20AMC/AMC%20-%2036%20-%20RUNWAY%20AND%20MOVEMENT%20AREA%20INSPECTIONS%20-%20ISSUE%2002.pdf)

These fields are especially important:
- Exact placement, because a vague “runway crack” is not actionable.
- Defect dimensions, because repair crews need length, width, and depth.
- Whether loose material exists, because loose debris changes the urgency.
- Whether a NOTAM or runway restriction is needed, because some defects affect operations immediately.
- Whether the issue is recurring, because recurrent defects often need a root-cause fix rather than a patch. [faa](https://www.faa.gov/documentLibrary/media/Advisory_Circular/draft-150-5200-30D-Chg2.pdf)

## How it would route

A real airport system would usually route the ticket from inspection to operations, then to maintenance, then to closeout verification. If the defect is severe enough to threaten safe operations, the system may also trigger a runway closure, inspection of nearby pavement, and an operational notification workflow. [gcaa.gov](https://www.gcaa.gov.ae/en/epublication/EPublications/Standalone%20AMC/AMC%20-%2036%20-%20RUNWAY%20AND%20MOVEMENT%20AREA%20INSPECTIONS%20-%20ISSUE%2002.pdf)

A realistic workflow is:
1. Inspector logs defect during daylight inspection.
2. Operations reviews severity and decides on restriction or closure.
3. Maintenance receives the work order with photos and location.
4. Crew repairs or removes hazard.
5. Supervisor re-inspects and closes the ticket.
6. Record is stored for pavement condition trending and future maintenance planning. [faa](https://www.faa.gov/documentLibrary/media/Advisory_Circular/draft-150-5200-30D-Chg2.pdf)

## A more complete sample

Here is a more polished version that looks like a real ticket in an airport maintenance system:

**Title:** RWY 28R - PCC spall with loose FOD in touchdown zone  
**Description:** Concrete spall observed during runway inspection. Loose fragments present on pavement surface. Immediate FOD hazard. Area cleared of visible debris, but permanent repair required.  
**Location:** Runway 28R, touchdown zone, left of centerline, approx. 1,850 ft from threshold, east edge of centerline stripe.  
**Priority:** P1 - safety critical  
**Status:** Open  
**Requested Action:** Sweep/vacuum area, remove loose material, evaluate slab, perform full-depth or partial-depth patch as required, seal adjacent joint if needed.  
**Operational Impact:** Coordinate with Airport Operations and ATC if repair requires temporary closure or work window.  
**Attachments:** Inspector photos, location map, field notes.  
**Acceptance Criteria:** No loose debris, repair conforms to airfield standards, surface flush enough for safe aircraft operations, re-inspected and signed off.  

The closer you want this to be to a real CMMS, the more the ticket should include asset hierarchy, SLA/priority codes, labor codes, materials, and a structured defect taxonomy tied to pavement distress categories and FOD reporting. [gcaa.gov](https://www.gcaa.gov.ae/en/epublication/EPublications/Standalone%20AMC/AMC%20-%2036%20-%20RUNWAY%20AND%20MOVEMENT%20AREA%20INSPECTIONS%20-%20ISSUE%2002.pdf)

Would you like me to turn this into a full **airport CMMS form**, a **JSON schema for software**, or a **sample ticket database table**?