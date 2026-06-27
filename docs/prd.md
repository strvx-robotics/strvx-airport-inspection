# PRD: Strvx Robotics Airport MVP

## AI-Assisted Runway Inspection & Work Order Creation

## 1. Product Summary

Strvx Robotics is building an MVP for airport operations teams to automate early-morning runway inspection workflows.

The system will use drone-captured imagery and computer vision to identify possible runway issues, organize them by runway and zone, present findings to a human inspector for review, and generate maintenance-ready tickets.

The MVP is not a fully autonomous safety-critical system. It is an AI-assisted inspection and documentation tool with a human in the loop.

## 2. Core Problem

Airport operations teams manually inspect runways before daily commercial activity begins. This process is time-consuming, labor-intensive, and requires operations staff to physically move around the airfield to identify deficiencies.

When issues are found, they must be documented, turned into work orders, sent to maintenance, repaired, and later reinspected.

Current workflow:

1. Operations agents inspect runway manually.
2. Issues are identified visually.
3. Deficiencies are logged.
4. Work orders are created for maintenance.
5. Maintenance completes repair.
6. Operations reinspects and closes the issue.

The MVP should reduce inspection time, improve documentation quality, and make issue-to-ticket creation faster.

## 3. MVP Goal

Build a dashboard that lets airport operations teams run or review drone-based runway inspections.

The drone collects images of each runway. The system analyzes those images for four issue categories, flags possible findings, and creates reviewable issue cards. A human inspector approves, rejects, or escalates each finding. Approved findings become maintenance tickets.

## 4. MVP Issue Categories

The MVP will inspect for four issue types:

### 1. Debris / FOD

Examples:

* Trash
* Loose objects
* Metal pieces
* Tools
* Plastic
* Rubber chunks
* Foreign objects on runway surface

### 2. Pavement Damage

Examples:

* Cracks
* Potholes
* Spalling
* Surface deterioration
* Loose aggregate
* Depressions
* Standing water or visible surface abnormalities

### 3. Runway Marking Issues

Examples:

* Faded markings
* Missing paint
* Obscured runway numbers
* Worn centerline markings
* Worn threshold markings
* Rubber buildup covering markings

### 4. Lighting / Signage Issues

Examples:

* Damaged runway lights
* Missing or obstructed lights
* Damaged signage
* Obstructed signage
* Misaligned or visibly broken fixtures

## 5. Non-Goals for MVP

The MVP will not include:

* Wildlife detection
* License plate reading
* Threat detection
* Voice communication
* Full autonomous maintenance ticket submission without review
* Fully automated FAA-critical decision-making
* Multi-drone coordination
* Drone swarm behavior
* GPS-denied autonomy
* Edge compute requirement
* Full Aeros Simple integration on day one

These can be considered after the first airport pilot.

## 6. Primary Users

### Admin

Responsible for setting up the airport environment.

Capabilities:

* Create airport profile
* Add runway names
* Create runway zones
* Upload or configure runway maps
* Manage users
* Configure inspection schedules

### Inspector / Operations Agent

Responsible for reviewing drone inspection results.

Capabilities:

* View scheduled inspections
* Review findings by runway
* Approve or reject issue candidates
* Add notes
* Create maintenance tickets
* Mark items for manual review

### Maintenance Team

Responsible for repairing approved issues.

Capabilities:

* View assigned tickets
* See issue location and images
* Update ticket status
* Mark repair complete
* Attach repair notes or images

## 7. Core Workflow

### Current State

Operations staff manually inspect the runway, identify issues, create tickets, maintenance repairs the issue, and operations reinspects.

### Strvx MVP Workflow

1. Inspection is scheduled for 6:00 AM.
2. Drone flies predefined route for Runway 1.
3. Drone captures images/video.
4. System uploads imagery to cloud.
5. Computer vision model scans for issue candidates.
6. System repeats process for Runway 2 and Runway 3.
7. Dashboard shows inspection summary.
8. Inspector reviews flagged issues.
9. Inspector approves, rejects, or marks issue for manual review.
10. Approved issues become maintenance tickets.
11. Maintenance repairs issue.
12. Inspector reinspects and closes ticket.

## 8. Product Screens

## 8.1 Inspection Overview Dashboard

Purpose: Give airport ops a quick view of runway status after inspection.

Fields:

* Inspection date
* Inspection time
* Airport name
* Runway list
* Status per runway
* Number of issues found
* Number of tickets open
* Number of tickets completed

Example:

Inspection: Monday, 6:00 AM

Runway 1: No issues found
Runway 2: 2 issues need review
Runway 3: No issues found

Statuses:

* Not started
* In progress
* Processing
* No issues found
* Issues need review
* Tickets created
* Completed
* Failed inspection run

## 8.2 Runway Detail Page

Purpose: Show inspection results for one runway.

Fields:

* Runway name
* Map / runway zone view
* Inspection timestamp
* Issue cards
* Image thumbnails
* Issue category
* AI confidence score
* Inspector decision
* Ticket status

Actions:

* View issue
* Approve ticket
* Reject finding
* Mark for manual review
* Add inspector note

## 8.3 Issue Detail Page

Purpose: Let inspector review one possible issue.

Fields:

* Issue ID
* Runway
* Zone / segment
* GPS coordinates if available
* Issue type
* Confidence score
* Severity
* Image evidence
* Suggested ticket text
* Inspector notes
* Status

Actions:

* Approve ticket
* Reject issue
* Request manual inspection
* Edit ticket description
* Assign to maintenance

## 8.4 Maintenance Ticket Page

Purpose: Give maintenance enough information to repair the issue.

Fields:

* Ticket ID
* Runway
* Zone
* Issue category
* Description
* Images
* Severity
* Created by
* Created at
* Assigned to
* Status
* Repair notes

Statuses:

* Draft
* Approved
* Sent to maintenance
* In progress
* Repaired
* Ready for reinspection
* Closed
* Rejected

## 9. Functional Requirements

## 9.1 Runway Setup

The system must allow an admin to:

* Create an airport
* Add runways
* Divide each runway into zones or segments
* Store inspection routes per runway
* Set inspection schedule
* Associate images/findings with a runway and zone

MVP route setup can be manual. Full automated drone route planning is not required for V1.

## 9.2 Inspection Scheduling

The system must support scheduled inspections.

MVP requirement:

* Admin can create a scheduled inspection time.
* Default example: 6:00 AM daily.
* System creates an inspection record for each runway.
* Each runway is treated as its own inspection job.

## 9.3 Image Upload / Ingestion

The system must support image ingestion from drone inspection runs.

MVP options:

* Manual image upload for V0
* Drone/cloud upload for V1
* Live drone integration for later versions

Each image should be tagged with:

* Airport
* Runway
* Zone if known
* Timestamp
* Flight/inspection ID
* Source file
* GPS metadata if available

## 9.4 Computer Vision Processing

The system must process inspection images and detect possible issues in the four MVP categories.

Required categories:

* Debris / FOD
* Pavement damage
* Runway marking issues
* Lighting / signage issues

The model output should include:

* Issue category
* Confidence score
* Bounding box or segmentation mask if available
* Source image
* Runway
* Zone
* Timestamp

The model does not need to be perfect. The goal is to generate reviewable candidates, not final decisions.

## 9.5 Human Review

All detected issues must go through human review before becoming maintenance tickets.

Inspector actions:

* Approve
* Reject
* Mark for manual review
* Edit issue category
* Edit severity
* Add notes
* Create ticket

The system should never automatically create a final maintenance ticket without human approval in the MVP.

## 9.6 Ticket Creation

When an inspector approves an issue, the system creates a maintenance ticket.

Ticket must include:

* Runway
* Zone
* Issue type
* Description
* Images
* Timestamp
* Suggested severity
* Inspector notes
* Status

For MVP, tickets can live inside the Strvx dashboard.

Later, tickets should integrate with the airport’s existing work order system.

## 9.7 Reinspection and Closure

After maintenance completes a repair, the system should support reinspection.

Minimum MVP:

* Maintenance can mark ticket as repaired.
* Inspector can mark ticket as closed after review.

Future:

* Drone can automatically reinspect the same zone.
* System compares before/after images.

## 10. AI / Model Requirements

## 10.1 MVP Model Philosophy

The model should be treated as an assistant, not the final authority.

The goal is to reduce the amount of manual review, not eliminate airport operations staff from the process.

## 10.2 Model Inputs

Inputs:

* Drone images
* Optional video frames
* Runway/zone metadata
* Timestamp
* Optional GPS metadata

## 10.3 Model Outputs

Outputs:

* Issue candidate
* Issue type
* Confidence score
* Image location
* Bounding box or highlighted region
* Suggested description

## 10.4 Confidence Thresholds

Suggested MVP thresholds:

* High confidence: Show as “Likely issue”
* Medium confidence: Show as “Needs review”
* Low confidence: Hide by default but keep available in raw model output

Do not automatically create tickets based only on confidence score.

## 10.5 Model Strategy

Recommended approach:

### FOD / Debris

Use object detection or anomaly detection.

Goal:

* Find unexpected objects on runway surface.

### Pavement Damage

Use segmentation or detection.

Goal:

* Flag visible cracks, potholes, spalling, deterioration, or abnormal pavement texture.

### Runway Markings

Start with image comparison or visual degradation detection.

Goal:

* Flag faded, obscured, or damaged markings.

### Lighting / Signage

Start with asset-based inspection.

Goal:

* Given known locations of lights/signs, verify whether they appear present, visible, and undamaged.

## 11. Data Model

## Airport

Fields:

* airport_id
* name
* location
* timezone
* created_at

## Runway

Fields:

* runway_id
* airport_id
* name
* description
* length
* zones
* active_status

## Zone

Fields:

* zone_id
* runway_id
* name
* start_position
* end_position
* notes

## Inspection

Fields:

* inspection_id
* airport_id
* scheduled_time
* started_at
* completed_at
* status
* created_by

## Inspection Runway Job

Fields:

* job_id
* inspection_id
* runway_id
* status
* started_at
* completed_at
* image_count
* issue_count

## Image

Fields:

* image_id
* job_id
* runway_id
* zone_id
* file_url
* timestamp
* gps_lat
* gps_lng
* metadata

## Issue Candidate

Fields:

* issue_id
* inspection_id
* runway_id
* zone_id
* image_id
* issue_type
* confidence
* severity
* status
* model_notes
* inspector_notes
* created_at

## Ticket

Fields:

* ticket_id
* issue_id
* runway_id
* zone_id
* status
* description
* assigned_to
* created_at
* repaired_at
* closed_at
* maintenance_notes

## 12. Success Metrics

## MVP Pilot Metrics

The MVP is successful if it can show:

* Time saved per inspection
* Number of runway issues detected
* Number of false positives
* Number of approved tickets created
* Time from inspection to ticket creation
* Inspector satisfaction
* Maintenance usability
* Quality of image evidence
* Ability to review runway status quickly

## Target MVP Outcomes

Initial targets:

* Complete inspection review dashboard for 1 airport
* Support at least 3 runways
* Process uploaded drone imagery
* Detect at least 2 of the 4 issue categories reasonably well
* Allow human approval/rejection
* Generate maintenance-ready tickets
* Export inspection report

## 13. MVP Build Phases

## Phase 0: Clickable Demo / Mock Data

Goal: Show airport stakeholders the workflow.

Build:

* Inspection overview dashboard
* Runway status cards
* Issue detail page
* Ticket detail page
* Fake AI detections
* Sample images
* Manual approve/reject

No drone integration required.

## Phase 1: Image Upload MVP

Goal: Process real drone imagery after a flight.

Build:

* Upload images by runway
* Store inspection record
* Run basic model or manual issue tagging
* Display findings
* Human review
* Generate tickets

This is the fastest buildable MVP.

## Phase 2: Drone Flight Integration

Goal: Connect real drone inspection runs to the dashboard.

Build:

* Predefined runway routes
* Image capture per route
* Cloud upload
* Auto-create inspection job
* Process images after flight

## Phase 3: Work Order Integration

Goal: Connect approved tickets to airport maintenance workflow.

Build:

* Export ticket as PDF/CSV
* Email ticket to maintenance
* Later: integrate with Aeros Simple or airport work order system

## Phase 4: Automated Reinspection

Goal: Close the loop after maintenance.

Build:

* Reinspect same zone
* Compare before/after images
* Inspector closes ticket
* Track repair completion

## 14. MVP Acceptance Criteria

The MVP is ready for pilot demo when:

* Admin can create airport/runways/zones.
* System can create a 6 AM inspection record.
* Images can be uploaded and associated with a runway.
* System can display inspection status per runway.
* System can show issue candidates.
* Inspector can approve/reject findings.
* Approved findings create tickets.
* Tickets contain images, location, issue type, and notes.
* Maintenance can mark ticket as repaired.
* Inspector can close ticket.
* System can export a basic inspection report.

## 15. Demo Script

Demo flow:

1. Show airport dashboard.
2. Start with “Monday, 6:00 AM Inspection.”
3. Show Runway 1: No issues found.
4. Show Runway 2: 2 issues need review.
5. Open Runway 2.
6. Review Issue 1: possible pavement damage.
7. Show images and confidence score.
8. Approve ticket.
9. Review Issue 2: possible debris.
10. Reject or approve.
11. Show maintenance ticket generated.
12. Mark ticket repaired.
13. Close after reinspection.

## 16. Key Product Principle

The MVP should not try to prove that Strvx can fully replace airport inspectors.

The MVP should prove that Strvx can help airport operations teams inspect faster, document better, and create maintenance tickets with less manual effort.
