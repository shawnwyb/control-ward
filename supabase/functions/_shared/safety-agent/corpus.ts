// Checked against official OSHA HTML 2026-10-17. Candidates require human review before use.
// Government regulatory text is public domain. These excerpts are intentionally limited in scope.
export const officialCorpus = [
  {
    key: "osha-fl-coverage",
    category: "official",
    title: "OSHA State Plans — Florida",
    issuing_body: "OSHA",
    url: "https://www.osha.gov/stateplans",
    audience: "crew",
    jurisdiction: "FL",
    task_tags: ["scope_context"],
    effective_on: null,
    superseded_on: null,
    passages: [
      {
        anchor: "Florida",
        excerpt:
          "Florida is not an OSHA-approved State Plan, and is under federal OSHA jurisdiction which covers most private sector workers within the state. State and local government workers are not covered by federal OSHA.",
        instruction:
          "Confirm employer coverage before applying federal OSHA requirements.",
        conditions:
          "Most private-sector workers; state/local government coverage is outside this pilot.",
      },
    ],
  },
  {
    key: "osha-1910-269",
    category: "official",
    title: "29 CFR 1910.269 — Job briefing",
    issuing_body: "OSHA",
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269",
    audience: "crew",
    jurisdiction: "FL",
    task_tags: ["electrical_maintenance"],
    effective_on: null,
    superseded_on: null,
    passages: [
      {
        anchor: "1910.269(c)(1)-(5)",
        excerpt:
          "Subjects to be covered. The briefing shall cover at least the following subjects: hazards associated with the job, work procedures involved, special precautions, energy-source controls, and personal protective equipment requirements.",
        instruction:
          "Before the job, review hazards, work procedures, special precautions, energy-source controls and PPE requirements with the employee in charge.",
        conditions:
          "Only confirmed covered operations/maintenance work. Read 1910.269(a)(1) and (c)(1)-(5): routine/repetitive jobs may share a briefing; significant safety changes require additional briefings; complicated/hazardous work or unfamiliar hazards require more extensive discussion. An employee working alone need not conduct a briefing, but the employer must plan the tasks as if one were required. This checklist does not determine PPE or energy-control settings.",
      },
      {
        anchor: "1910.269(c)(3)(ii)",
        excerpt:
          "Additional job briefings shall be held if significant changes, which might affect the safety of the employees, occur during the course of the work.",
        instruction:
          "Hold an additional job briefing when significant changes could affect employee safety.",
        conditions:
          "Covered work and significant safety-related changes; see all of 1910.269(c), including the working-alone exception in (c)(5).",
      },
      {
        anchor: "1910.269(a)(4)",
        excerpt:
          "Existing characteristics and conditions. Existing characteristics and conditions of electric lines and equipment that are related to the safety of the work to be performed shall be determined before work on or near the lines or equipment is started.",
        instruction:
          "Determine safety-related characteristics and conditions of the lines and equipment before starting work on or near them.",
        conditions:
          "Covered work only. The full paragraph lists nominal and switching-transient voltages, induced voltages, protective grounds, circuit locations, pole condition and environmental conditions. Confirm applicable procedures with the employee in charge; no electrical values are supplied here.",
      },
    ],
  },
  {
    key: "osha-1926-950-scope",
    category: "official",
    title: "29 CFR 1926.950 — Construction scope (context only)",
    issuing_body: "OSHA",
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.950",
    audience: "crew",
    jurisdiction: "FL",
    task_tags: ["scope_context"],
    effective_on: null,
    superseded_on: null,
    passages: [
      {
        anchor: "1926.950(a)(1)-(3)",
        excerpt:
          "Work involving electric power generation installations shall comply with § 1910.269 of this chapter.",
        instruction:
          "Request scope review for construction; the maintenance pilot does not determine construction requirements.",
        conditions:
          "Read 1926.950(a)(1)-(3) together, including transmission/distribution construction scope, other part 1926 standards, unqualified-employee exception and generation-installation cross-reference. Construction is unsupported by this MVP.",
      },
    ],
  },
];

export function demoProcedure(siteId: string) {
  return {
    key: `fictional-demo-briefing-${siteId}`,
    site_id: siteId,
    category: "company_policy",
    title: "FICTIONAL DEMO — pre-job procedure",
    issuing_body: "ControlWard demo company (fictional)",
    url: null,
    audience: "crew",
    jurisdiction: "FL",
    task_tags: ["electrical_maintenance"],
    effective_on: null,
    superseded_on: null,
    fictional: true,
    passages: [
      {
        anchor: "demo-prejob",
        excerpt:
          "FICTIONAL DEMO ONLY. Before work, locate the current site procedure and ask the supervisor to confirm the planned task and unresolved conditions. This example is not an approved procedure for a real employer.",
        instruction:
          "DEMO ONLY: ask the supervisor to confirm the planned task and current site procedure.",
        conditions:
          "Fictional local demonstration. Never use as a real company procedure.",
      },
    ],
  };
}
