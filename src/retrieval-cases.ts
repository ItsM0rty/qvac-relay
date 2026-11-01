export type RetrievalCase = {
  id: string;
  split: 'development' | 'heldout';
  family: string;
  task: string;
  evidence: { id: string; title: string; text: string }[];
  requiredSourceIds: string[];
  expectedSpans: { sourceId: string; quote: string }[];
};

// Frozen before model evaluation. Quotes are retrieval targets, not model truth scores.
export const RETRIEVAL_FIXTURE_VERSION = 'retrieval-cases-v2';
const background = 'The shift log lists routine checks, owner assignments, inventory counts, and the time of the next review. No decision is recorded in this paragraph. ';
const late = (quote: string) => `${background.repeat(16)}${quote}`;
// Independent archives describe different operational events; none answer the case tasks.
const archiveTopics = [
  ['INC-104 pump inspection', 'The water pump inlet strainer had mineral deposits. A mechanic cleaned the mesh, photographed the seal, and logged the water pressure in kPa. The next inspection is assigned to the afternoon shift.'],
  ['INC-218 access badge audit', 'A visitor badge was returned to the reception desk after the sign-out book was closed. Security reconciled the badge count against the visitor register and filed the signed sheet.'],
  ['INC-337 warehouse lighting', 'An aisle light flickered during the stock count. Facilities replaced the driver and confirmed that the emergency lighting circuit remained available during the work.'],
  ['INC-441 printer queue', 'A label printer paused while its local spool was full. Staff cleared old print jobs, loaded a new roll, and checked that the barcode scanner could read a sample label.'],
  ['INC-556 training room', 'The projector cable was missing from the training room. The coordinator borrowed a cable from reception and updated the equipment checklist after the meeting.'],
  ['INC-602 generator exercise', 'During the weekly generator exercise the fuel gauge displayed half a tank. The technician compared the gauge with the dip reading and recorded both values in the maintenance book.'],
  ['INC-714 radio battery', 'A handheld radio battery did not latch securely in its cradle. The operator set it aside for inspection and issued a spare radio to the night crew.'],
  ['INC-829 loading bay', 'The loading bay door travel was slower than usual after a hinge inspection. Maintenance lubricated the hinge and timed three empty cycles before returning the door to service.'],
] as const;
const archive = (caseId: string) => archiveTopics.map(([title, detail], index) => ({
  id: `${caseId}-archive-${index + 1}`,
  title,
  text: [
    `${title}: ${detail}`,
    'The first observer recorded the situation in the handover book before equipment was moved. The entry includes the location, the shift, and the condition as found.',
    'A second operator checked the area against the routine inspection list and confirmed that surrounding work could continue. Neighboring systems remained in service.',
    'The responsible team gathered the ordinary tools for this type of maintenance and checked them for visible damage. The supervisor recorded who would perform and verify the work.',
    'Before work started, the coordinator notified the people using the area and marked the location. The temporary arrangement was entered in the shift notes for the incoming crew.',
    'The team completed the local intervention described above and returned borrowed equipment to storage. The operator signed the maintenance book after inspecting the surroundings.',
    'A follow-up walk-through checked for loose materials and confirmed that access routes remained clear. Spare items were counted and put back in their assigned places.',
    'The next shift reviewed the entry with the outgoing operator. They agreed to watch the item during the next ordinary round and record a fresh observation if the condition returned.',
    'The supervisor attached the completed checklist to the incident folder and noted that routine work was finished. The folder remains available for its scheduled review.',
    'The administrative closeout lists the site contact, the work location, and the next planned inspection. These notes concern this local equipment event.',
    'The record was retained with its date and initials. The supervisor checked the handover register and assigned the next inspection to the team responsible for this location.',
    'At the next planning meeting the team reviewed the local maintenance schedule and confirmed access to the area. The inspection checklist was placed with the other site records.',
  ].join(' '),
}));
const make = (id: string, split: RetrievalCase['split'], family: string, task: string, facts: [string, string][], distractor: string): RetrievalCase => ({
  id, split, family, task,
  evidence: [
    ...facts.map(([sourceId, quote], i) => ({ id: sourceId, title: `${family} field note ${i + 1}`, text: i === 0 && (id === 'dev-checkout-1' || id === 'held-cold-1') ? late(quote) : `${background.repeat(2)}${quote}` })),
    { id: `${id}-other`, title: 'Unrelated incident log', text: `${background.repeat(2)}${distractor}` },
    ...archive(id),
  ],
  requiredSourceIds: facts.map(([sourceId]) => sourceId),
  expectedSpans: facts.map(([sourceId, quote]) => ({ sourceId, quote })),
});

export const RETRIEVAL_CASES: RetrievalCase[] = [
  make('dev-checkout-1', 'development', 'checkout', 'Why did buyers see duplicate orders and what stopped them?', [
    ['checkout-cause', 'A retry after the payment response was lost created a second order.' ],
    ['checkout-fix', 'The checkout team enabled idempotency keys for payment retries.'],
  ], 'The database timeout drill used a 30 second timer and did not involve buyers.'),
  make('dev-db-1', 'development', 'database-timeout', 'Which resource caused the stalled queries and what changed?', [
    ['db-cause', 'The connection pool was exhausted while idle transactions held slots.'],
    ['db-fix', 'Operators closed idle transactions and raised the pool limit from 40 to 60.'],
  ], 'Checkout retries were harmless in the unrelated storefront exercise.'),
  make('dev-checkout-2', 'development', 'checkout', 'When should checkout retries be disabled?', [
    ['checkout-condition', 'Do not disable checkout retries unless the payment provider confirms an ongoing duplicate-charge incident.'],
  ], 'An unrelated database timeout prompted immediate retry suppression in the analytics worker.'),
  make('held-cold-1', 'heldout', 'refrigerated-shipping', 'What was the maximum acceptable cargo temperature and what was observed?', [
    ['cold-limit', 'The vaccine cargo limit was 8 °C, not 8 °F.'],
    ['cold-observed', 'The rear pallet probe recorded 11 °C for 18 minutes.'],
  ], 'A satellite uplink temperature alarm was tested at 11 °C without cargo.'),
  make('held-cold-2', 'heldout', 'refrigerated-shipping', 'Under what condition may the shipment be released?', [
    ['cold-release', 'Do not release the shipment unless quality assurance signs the excursion review.'],
  ], 'The charging unit may be released after a voltage check in another incident.'),
  make('held-link-1', 'heldout', 'satellite-uplink', 'What caused the irregular arrival times and how was the link stabilized?', [
    ['link-cause', 'An overloaded ground modem queue caused packet delay variation on the uplink.'],
    ['link-fix', 'The team moved the feed to a dedicated modem and reduced queue occupancy.'],
  ], 'The certificate rollover had no packet jitter; its problem was an expired intermediate.'),
  make('held-cert-1', 'heldout', 'certificate-rollover', 'Why did some clients reject the new identity and what fixed the chain?', [
    ['cert-cause', 'The server sent the new leaf certificate without its intermediate certificate.'],
    ['cert-fix', 'Adding the missing intermediate to the served chain restored client validation.'],
  ], 'A different satellite uplink was restored by replacing a modem queue.'),
  make('held-charge-1', 'heldout', 'charging-unit', 'What voltage is allowed for the unit while wet?', [
    ['charge-rule', 'When the connector is wet, do not energize the charging unit at any voltage.'],
    ['charge-dry', 'After the connector is verified dry, the unit may operate at 48 V DC.'],
  ], 'A refrigerated shipping alarm used an 8 °C threshold, not a voltage limit.'),
  make('held-none-1', 'heldout', 'charging-unit', 'Which charging unit firmware version fixed the reported reset?', [],
    'A charging depot counted twelve spare cable clips and four mounting brackets in its parts cupboard.'),
];

// Canonical identity uses the ordered, JSON-serialized fixture array.
export const RETRIEVAL_CASES_STABLE_ID = '306b32f7ae3f22823f76e34d03cb07858ce1befd2e709949ade16784a56d2bf4';




