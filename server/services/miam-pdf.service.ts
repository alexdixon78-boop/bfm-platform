import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import type { MiamRecord } from "@shared/schema";

interface ChildEntry {
  name: string;
  firstName?: string;
  lastName?: string;
  dob: string;
  age: string;
  gender: string;
  livesWithClient: string;
  residenceAddress: string;
  contactArrangements: string;
  school: string;
  notes: string;
}

interface ChecklistItemValue {
  status: string;
  notes: string;
}

const CHECKLIST_ITEMS = [
  { key: "fourMonthRule", label: "Made client aware of 4-month rule, in relation to filing court application", type: "item" as const },
  { key: "legalPrivilege", label: "Mediation legally privileged / not binding", type: "item" as const },
  { key: "legalAdvice", label: "Had legal advice? Would like free consultation?", type: "item" as const },
  { key: "legalAidInfo", label: "Information given on legal aid?", type: "item" as const },
  { key: "reconciliation", label: "Reconciliation tried? Recently?", type: "item" as const },
  { key: "otherAgencies", label: "Other agency/ies signposted (if yes, specify)", type: "item" as const },
  { key: "adrInfoHeader", label: "Info given about alternatives:", type: "header" as const },
  { key: "adrArbitration", label: "Arbitration", type: "subItem" as const },
  { key: "adrCollaborativeLaw", label: "Collaborative law", type: "subItem" as const },
  { key: "adrNegotiation", label: "Negotiation through solicitors", type: "subItem" as const },
  { key: "adrEarlyNeutralEvaluation", label: "Early neutral evaluation", type: "subItem" as const },
  { key: "adrPrivateFdr", label: "Private FDR", type: "subItem" as const },
  { key: "conflictOfInterest", label: "Conflict of interest?", type: "item" as const },
  { key: "priorCourtOrders", label: "Any previous or current court orders?", type: "item" as const },
  { key: "caringAdults", label: "Are there other adults with caring responsibilities who should be involved?", type: "item" as const },
  { key: "pfAimFinancial", label: "In P&F/AIM: Financial Disclosure booklet, OFS and MOU explanation with fees", type: "item" as const },
  { key: "childrenCasesMou", label: "In children's cases: MOU purpose/fees, Statement of child arrangements purpose/fees", type: "item" as const },
  { key: "onlineWillingness", label: "Willing to mediate online?", type: "item" as const },
  { key: "estimatedSessions", label: "No. of sessions estimated — special conditions e.g. shuttle or hybrid mediation?", type: "item" as const },
  { key: "mojVoucherScheme", label: "MOJ voucher discussed/eligible? (check they haven't claimed before)", type: "item" as const },
];

const ISSUES_ITEMS = [
  { key: "childArrangements", label: "Child/ren's arrangements" },
  { key: "livingArrangements", label: "Living arrangements" },
  { key: "timeWithEachParent", label: "Time spent with each parent" },
  { key: "prIssues", label: "PR issues, e.g. health, faith, education, travel, re-location, name change" },
  { key: "communications", label: "Communications" },
  { key: "maintenance", label: "Maintenance" },
  { key: "other", label: "Other (please specify)" },
  { key: "financialSettlement", label: "Financial settlement" },
  { key: "accommodation", label: "Accommodation / family home" },
  { key: "otherAssets", label: "Other assets" },
  { key: "liabilities", label: "Liabilities" },
  { key: "pensions", label: "Pensions" },
  { key: "spousalMaintenance", label: "Spousal maintenance" },
];

const FURTHER_INFO_ITEMS = [
  { key: "freeConsultation", label: "Free consultation" },
  { key: "c100Assistance", label: "Help with completing the C100/Form A/Draft Consent order?" },
  { key: "solicitorsLegalAdvice", label: "Solicitors/legal advice?" },
  { key: "divorceCoaching", label: "Divorce/separation coaching?" },
  { key: "counsellingTherapy", label: "Therapy/counselling?" },
  { key: "financialAdvice", label: "Financial advice/planning?" },
  { key: "mortgageAdvisors", label: "Mortgage Advisors" },
  { key: "wills", label: "Wills?" },
  { key: "otherInfo", label: "Other?" },
];

const DA_SUPPORT_SERVICES = [
  { key: "womensAid", label: "Women's Aid" },
  { key: "refuge", label: "Refuge" },
  { key: "respectMensAdviceLine", label: "Respect (Men's Advice Line)" },
  { key: "nationalDomesticAbuseHelpline", label: "National Domestic Abuse Helpline" },
  { key: "localIdvaServices", label: "Local IDVA services" },
  { key: "other", label: "Other" },
];

const BRAND_GREY = "#666666";
const BRAND_SAGE = "#5a7d58";
const HEADER_BG = "#f5f5f0";
const TABLE_BORDER = "#cccccc";
const PAGE_MARGIN = 50;

function s(val: string | null | undefined): string {
  return val || "";
}

function formatYesNo(val: string | null | undefined): string {
  if (!val) return "";
  if (val === "yes") return "Yes";
  if (val === "no") return "No";
  if (val === "n/a") return "N/A";
  return val;
}

export function generateMiamPdf(record: MiamRecord, caseRef: string): PDFKit.PDFDocument {
  const logoPath = path.resolve("attached_assets/Logo_white_background_1771923374048.png");
  const hasLogo = fs.existsSync(logoPath);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: `MIAM Record - ${caseRef || ""}`,
      Author: "Brighter Future Mediation",
      Subject: "MIAM Record",
    },
  });

  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const children: ChildEntry[] = Array.isArray(record.children) ? (record.children as ChildEntry[]) : [];
  const checklist: Record<string, ChecklistItemValue> = typeof record.checklist === "object" && record.checklist !== null ? (record.checklist as Record<string, ChecklistItemValue>) : {};
  const issues: Record<string, ChecklistItemValue> = typeof record.issuesForMediation === "object" && record.issuesForMediation !== null ? (record.issuesForMediation as Record<string, ChecklistItemValue>) : {};
  const furtherInfo: Record<string, ChecklistItemValue> = typeof record.furtherInfoRequested === "object" && record.furtherInfoRequested !== null ? (record.furtherInfoRequested as Record<string, ChecklistItemValue>) : {};
  const daServices: string[] = Array.isArray(record.domesticAbuseSupportServices) ? (record.domesticAbuseSupportServices as string[]) : [];
  const ppcReasons: string[] = Array.isArray(record.ppcReason) ? (record.ppcReason as string[]) : [];
  const marriedYes = record.married === "yes";
  const livedTogetherYes = record.livedTogether === "yes";
  const divorceStartedYes = record.divorceStarted === "yes";
  const welfareAgencyContactedYes = record.welfareAgencyContacted === "yes";
  const childInclusiveExplainedYes = record.childInclusiveExplained === "yes";
  const ppcRequiredYes = record.ppcRequired === "yes";
  const referralToChildrenServicesYes = record.referralToChildrenServices === "yes";
  const showSuitabilityReasons = record.suitableForMediation === "yes" || record.suitableForMediation === "no";

  function getVal(collection: Record<string, ChecklistItemValue>, key: string): ChecklistItemValue {
    return collection[key] || { status: "", notes: "" };
  }

  function ensureSpace(needed: number) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + needed > bottom) {
      doc.addPage();
    }
  }

  function drawSectionHeader(title: string) {
    ensureSpace(35);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(PAGE_MARGIN, y, pageWidth, 24).fill(BRAND_SAGE);
    doc.fillColor("white").fontSize(11).font("Helvetica-Bold")
      .text(title, PAGE_MARGIN + 8, y + 6, { width: pageWidth - 16 });
    doc.fillColor("black").font("Helvetica");
    doc.y = y + 30;
  }

  function drawFieldRow(label: string, value: string, labelWidth = 200) {
    ensureSpace(20);
    const y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND_GREY)
      .text(label, PAGE_MARGIN + 4, y, { width: labelWidth, continued: false });
    const labelBottom = doc.y;
    doc.fontSize(9).font("Helvetica").fillColor("black")
      .text(value, PAGE_MARGIN + labelWidth + 4, y, { width: pageWidth - labelWidth - 8 });
    const valueBottom = doc.y;
    doc.y = Math.max(labelBottom, valueBottom) + 2;
  }

  function drawTwoColumnFields(fields: Array<{ label: string; value: string }>) {
    const colWidth = (pageWidth - 20) / 2;
    const labelW = colWidth * 0.45;
    const valueW = colWidth * 0.55;
    for (let i = 0; i < fields.length; i += 2) {
      const left = fields[i];
      const right = fields[i + 1];
      const leftLabelH = doc.fontSize(9).font("Helvetica-Bold").heightOfString(left.label + ":", { width: labelW });
      const leftValueH = doc.fontSize(9).font("Helvetica").heightOfString(left.value || "", { width: valueW });
      let maxH = Math.max(leftLabelH, leftValueH);
      if (right) {
        const rightLabelH = doc.fontSize(9).font("Helvetica-Bold").heightOfString(right.label + ":", { width: labelW });
        const rightValueH = doc.fontSize(9).font("Helvetica").heightOfString(right.value || "", { width: valueW });
        maxH = Math.max(maxH, rightLabelH, rightValueH);
      }
      const rowH = maxH + 4;
      ensureSpace(rowH);
      const y = doc.y;

      doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND_GREY)
        .text(left.label + ":", PAGE_MARGIN + 4, y, { width: labelW });
      doc.fontSize(9).font("Helvetica").fillColor("black")
        .text(left.value, PAGE_MARGIN + 4 + labelW, y, { width: valueW });

      if (right) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND_GREY)
          .text(right.label + ":", PAGE_MARGIN + colWidth + 16, y, { width: labelW });
        doc.fontSize(9).font("Helvetica").fillColor("black")
          .text(right.value, PAGE_MARGIN + colWidth + 16 + labelW, y, { width: valueW });
      }
      doc.y = y + rowH;
    }
  }

  function drawTextBlock(label: string, value: string) {
    ensureSpace(40);
    doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND_GREY)
      .text(label, PAGE_MARGIN + 4, doc.y, { width: pageWidth - 8 });
    doc.moveDown(0.2);
    if (value) {
      doc.fontSize(9).font("Helvetica").fillColor("black")
        .text(value, PAGE_MARGIN + 4, doc.y, { width: pageWidth - 8 });
    }
    doc.moveDown(0.3);
  }

  function drawChecklistTable(items: Array<{ key: string; label: string; type?: string }>, data: Record<string, ChecklistItemValue>) {
    const labelCol = pageWidth - 130;
    const statusCol = 50;
    const notesCol = 80;

    ensureSpace(25);
    const headerY = doc.y;
    doc.rect(PAGE_MARGIN, headerY, pageWidth, 18).fill(HEADER_BG);
    doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND_GREY);
    doc.text("Item", PAGE_MARGIN + 4, headerY + 4, { width: labelCol - 8 });
    doc.text("Y/N", PAGE_MARGIN + labelCol + 2, headerY + 4, { width: statusCol, align: "center" });
    doc.text("Notes", PAGE_MARGIN + labelCol + statusCol + 2, headerY + 4, { width: notesCol });
    doc.y = headerY + 20;

    for (const item of items) {
      if (item.type === "header") {
        ensureSpace(18);
        const hy = doc.y;
        doc.rect(PAGE_MARGIN, hy, pageWidth, 16).fill("#f0f0f0");
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND_GREY)
          .text(item.label, PAGE_MARGIN + 4, hy + 3, { width: labelCol });
        doc.y = hy + 18;
        continue;
      }

      const val = getVal(data, item.key);
      const indent = item.type === "subItem" ? 16 : 0;

      const textHeight = doc.fontSize(8).font("Helvetica").heightOfString(item.label, { width: labelCol - 8 - indent });
      const rowHeight = Math.max(textHeight + 6, 16);
      ensureSpace(rowHeight);

      const ry = doc.y;
      doc.rect(PAGE_MARGIN, ry, pageWidth, rowHeight).stroke(TABLE_BORDER);
      doc.rect(PAGE_MARGIN + labelCol, ry, statusCol, rowHeight).stroke(TABLE_BORDER);

      doc.fontSize(8).font("Helvetica").fillColor("black")
        .text(item.label, PAGE_MARGIN + 4 + indent, ry + 3, { width: labelCol - 8 - indent });
      doc.fontSize(8).font("Helvetica").fillColor("black")
        .text(formatYesNo(val.status), PAGE_MARGIN + labelCol + 2, ry + 3, { width: statusCol, align: "center" });
      if (val.notes) {
        doc.fontSize(7).font("Helvetica").fillColor(BRAND_GREY)
          .text(val.notes, PAGE_MARGIN + labelCol + statusCol + 2, ry + 3, { width: notesCol - 4 });
      }
      doc.y = ry + rowHeight;
    }
  }

  function drawIssuesGrid(items: Array<{ key: string; label: string }>, data: Record<string, ChecklistItemValue>) {
    const colWidth = (pageWidth - 10) / 2;
    const leftItems = items.slice(0, 7);
    const rightItems = items.slice(7);

    for (let i = 0; i < Math.max(leftItems.length, rightItems.length); i++) {
      const left = leftItems[i];
      const right = rightItems[i];
      let maxH = 12;
      if (left) {
        const lv = getVal(data, left.key);
        const mark = lv.status === "yes" ? "X" : " ";
        const h = doc.fontSize(8).font("Helvetica").heightOfString(`[${mark}] ${left.label}`, { width: colWidth - 8 });
        maxH = Math.max(maxH, h);
      }
      if (right) {
        const rv = getVal(data, right.key);
        const mark = rv.status === "yes" ? "X" : " ";
        const h = doc.fontSize(8).font("Helvetica").heightOfString(`[${mark}] ${right.label}`, { width: colWidth - 8 });
        maxH = Math.max(maxH, h);
      }
      const rowH = maxH + 4;
      ensureSpace(rowH);
      const ry = doc.y;

      if (left) {
        const lv = getVal(data, left.key);
        const mark = lv.status === "yes" ? "X" : " ";
        doc.fontSize(8).font("Helvetica").fillColor("black")
          .text(`[${mark}] ${left.label}`, PAGE_MARGIN + 4, ry + 1, { width: colWidth - 8 });
      }
      if (right) {
        const rv = getVal(data, right.key);
        const mark = rv.status === "yes" ? "X" : " ";
        doc.fontSize(8).font("Helvetica").fillColor("black")
          .text(`[${mark}] ${right.label}`, PAGE_MARGIN + colWidth + 10, ry + 1, { width: colWidth - 8 });
      }
      doc.y = ry + rowH;
    }
  }

  if (hasLogo) {
    doc.image(logoPath, PAGE_MARGIN, 30, { width: 120 });
    doc.y = 60;
  }

  doc.fontSize(18).font("Helvetica-Bold").fillColor(BRAND_SAGE)
    .text("MIAM Record", PAGE_MARGIN, doc.y, { align: "center", width: pageWidth });
  doc.moveDown(0.3);
  if (caseRef) {
    doc.fontSize(10).font("Helvetica").fillColor(BRAND_GREY)
      .text(`Case Reference: ${caseRef}`, PAGE_MARGIN, doc.y, { align: "center", width: pageWidth });
  }
  doc.moveDown(0.5);

  drawSectionHeader("1. MIAM Record");
  drawFieldRow("Mediator:", s(record.sessionMediator));
  drawFieldRow("Date:", s(record.sessionDate));
  drawFieldRow("Time:", s(record.sessionTime));
  drawFieldRow("Other people present?:", s(record.otherPeoplePresent));
  drawFieldRow("Case reference:", s(record.caseReference));
  drawFieldRow("Type of case:", s(record.caseType));

  drawSectionHeader("2. Client Information");
  const clientDisplayName = [s(record.clientFirstName), s(record.clientLastName)].filter(Boolean).join(" ") || s(record.clientName);
  drawFieldRow("Name:", clientDisplayName);
  drawFieldRow("DOB:", s(record.clientDob));
  drawFieldRow("Address:", s(record.clientAddress));
  drawFieldRow("Confirm Telephone:", s(record.clientPhone));
  drawFieldRow("How did you hear about BFM?:", s(record.howHeardAboutBfm));
  drawFieldRow("Occupation:", s(record.clientOccupation));
  drawFieldRow("Disability/accessibility needs:", s(record.clientDisability));
  drawFieldRow("How to make process accessible:", s(record.clientAccessibility));
  drawFieldRow("Ethnicity:", s(record.clientEthnicity));
  drawFieldRow("Religious/cultural needs:", s(record.clientReligiousCulturalNeeds));
  drawFieldRow("New partner (live together?):", s(record.clientNewPartner));

  drawSectionHeader("3. Introduction");
  drawFieldRow("Purpose of meeting discussed?:", formatYesNo(record.introPurposeDiscussed));
  drawFieldRow("Confidentiality & exceptions explained?:", formatYesNo(record.introConfidentialityExplained));
  if (s(record.introNotes)) {
    drawTextBlock("Notes:", s(record.introNotes));
  }

  drawSectionHeader("4. Child/ren's Names");
  if (children.length > 0) {
    const cols = ["Name", "DOB", "Address/Residence", "Age", "Gender", "Lives with client?"];
    const colWidths = [90, 60, 100, 30, 40, pageWidth - 90 - 60 - 100 - 30 - 40];

    ensureSpace(20);
    const thy = doc.y;
    doc.rect(PAGE_MARGIN, thy, pageWidth, 16).fill(HEADER_BG);
    let cx = PAGE_MARGIN;
    for (let ci = 0; ci < cols.length; ci++) {
      doc.fontSize(7).font("Helvetica-Bold").fillColor(BRAND_GREY)
        .text(cols[ci], cx + 2, thy + 3, { width: colWidths[ci] - 4 });
      cx += colWidths[ci];
    }
    doc.y = thy + 18;

    for (const child of children) {
      const childDisplayName = [child.firstName || "", child.lastName || ""].filter(Boolean).join(" ") || child.name;
      const vals = [childDisplayName, child.dob, child.residenceAddress || "", child.age, child.gender, child.livesWithClient];
      const textHeight = Math.max(...vals.map((v, i) =>
        doc.fontSize(7).font("Helvetica").heightOfString(v || "", { width: colWidths[i] - 4 })
      ));
      const rowH = Math.max(textHeight + 6, 14);
      ensureSpace(rowH);
      const ry = doc.y;
      doc.rect(PAGE_MARGIN, ry, pageWidth, rowH).stroke(TABLE_BORDER);
      let rx = PAGE_MARGIN;
      for (let ci = 0; ci < vals.length; ci++) {
        doc.fontSize(7).font("Helvetica").fillColor("black")
          .text(vals[ci] || "", rx + 2, ry + 3, { width: colWidths[ci] - 4 });
        rx += colWidths[ci];
      }
      doc.y = ry + rowH;

      if (child.contactArrangements || child.school || child.notes) {
        ensureSpace(14);
        const extraY = doc.y;
        const extras: string[] = [];
        if (child.contactArrangements) extras.push(`Contact: ${child.contactArrangements}`);
        if (child.school) extras.push(`School: ${child.school}`);
        if (child.notes) extras.push(`Notes: ${child.notes}`);
        doc.fontSize(7).font("Helvetica").fillColor(BRAND_GREY)
          .text(extras.join(" | "), PAGE_MARGIN + 8, extraY + 1, { width: pageWidth - 16 });
        doc.moveDown(0.2);
      }
    }
  } else {
    doc.fontSize(9).font("Helvetica").fillColor(BRAND_GREY)
      .text("No children recorded.", PAGE_MARGIN + 4, doc.y);
    doc.moveDown(0.3);
  }

  drawSectionHeader("5. Other Client's Details");
  const otherClientDisplayName = [s(record.otherClientFirstName), s(record.otherClientLastName)].filter(Boolean).join(" ") || s(record.otherClientName);
  drawFieldRow("Full name:", otherClientDisplayName);
  drawFieldRow("Date of Birth:", s(record.otherClientDob));
  drawFieldRow("Address:", s(record.otherClientAddress));
  drawFieldRow("Telephone number:", s(record.otherClientPhone));
  drawFieldRow("Email:", s(record.otherClientEmail));

  drawSectionHeader("6. Marriage and Co-habitation");
  drawTwoColumnFields([
    { label: "Married", value: formatYesNo(record.married) },
    ...(marriedYes ? [
      { label: "Date of marriage", value: s(record.dateOfMarriage) },
      { label: "Divorce started", value: `${formatYesNo(record.divorceStarted)} ${divorceStartedYes && s(record.divorceStartedDate) ? `(${s(record.divorceStartedDate)})` : ""}` },
    ] : []),
    ...(marriedYes && divorceStartedYes ? [
      { label: "Petitioner", value: s(record.petitioner) },
      { label: "Decree Nisi/Conditional order", value: s(record.decreeNisiDate) },
      { label: "Decree Absolute/Final order", value: s(record.decreeAbsoluteDate) },
    ] : []),
    { label: "Lived together", value: formatYesNo(record.livedTogether) },
    ...(livedTogetherYes ? [{ label: "Date of cohabitation", value: s(record.dateOfCohabitation) }] : []),
    { label: "Date of separation", value: s(record.dateOfSeparation) },
    { label: "Court orders", value: s(record.courtOrders) },
    { label: "Both parents have PR", value: formatYesNo(record.bothParentsPr) },
    { label: "Applications to court", value: s(record.applicationsToCourtText) },
    { label: "Is PR an issue", value: formatYesNo(record.prIsIssue) },
  ]);

  drawSectionHeader("7. Checklist");
  drawChecklistTable(CHECKLIST_ITEMS, checklist);

  drawSectionHeader("8. Background Notes and Current Living/Parenting Arrangements");
  if (s(record.bgWhatBringsYou)) {
    drawTextBlock("What brings you here today?:", s(record.bgWhatBringsYou));
  }
  if (s(record.bgLivingArrangements)) {
    drawTextBlock("Living arrangements:", s(record.bgLivingArrangements));
  }
  if (s(record.bgChildrenDetails)) {
    drawTextBlock("Children details:", s(record.bgChildrenDetails));
  }
  if (s(record.bgContactArrangements)) {
    drawTextBlock("Contact arrangements:", s(record.bgContactArrangements));
  }
  if (s(record.backgroundNotes)) {
    drawTextBlock("Additional notes:", s(record.backgroundNotes));
  }

  drawSectionHeader("9. Welfare of Child/ren and Other Children's Issues");
  drawFieldRow("Welfare concerns:", formatYesNo(record.welfareOfChildren));
  if (s(record.welfareChildrensServices)) {
    drawTextBlock("Children's services involved?:", s(record.welfareChildrensServices));
  }
  if (s(record.welfareSafetyConcerns)) {
    drawTextBlock("Safety concerns for any child?:", s(record.welfareSafetyConcerns));
  }
  if (s(record.welfareWitnessedConflict)) {
    drawTextBlock("Child witnessed conflict/DA?:", s(record.welfareWitnessedConflict));
  }
  if (s(record.welfareInjuriesBehaviouralChanges)) {
    drawTextBlock("Injuries/behavioural changes?:", s(record.welfareInjuriesBehaviouralChanges));
  }
  if (s(record.welfareSafeguardingPlans)) {
    drawTextBlock("Safeguarding plans?:", s(record.welfareSafeguardingPlans));
  }
  drawFieldRow("Agency contacted:", formatYesNo(record.welfareAgencyContacted));
  if (welfareAgencyContactedYes) {
    drawFieldRow("Agency name:", s(record.welfareAgencyName));
    drawFieldRow("Date:", s(record.welfareAgencyDate));
    drawFieldRow("Time:", s(record.welfareAgencyTime));
  }
  if (s(record.welfareNotes)) {
    drawTextBlock("Notes:", s(record.welfareNotes));
  }

  drawSectionHeader("10. Child Inclusive Mediation");
  drawFieldRow("Explained to client?:", formatYesNo(record.childInclusiveExplained));
  if (childInclusiveExplainedYes) {
    drawFieldRow("Client's response:", s(record.childInclusiveClientResponse));
    drawFieldRow("Confidentiality explained?:", formatYesNo(record.childInclusiveConfidentialityExplained));
    drawFieldRow("Consent agreed?:", formatYesNo(record.childInclusiveConsentAgreed));
    if (s(record.childInclusiveNotes)) {
      drawTextBlock("Notes:", s(record.childInclusiveNotes));
    }
  }

  drawSectionHeader("11. Screening for Domestic Abuse / Imbalance of Power and Control");
  if (s(record.daHurtOrScared)) {
    drawTextBlock("Hurt/scared by partner?:", s(record.daHurtOrScared));
  }
  if (s(record.daPoliceInvolved)) {
    drawTextBlock("Police involved?:", s(record.daPoliceInvolved));
  }
  if (s(record.daPhysical)) {
    drawTextBlock("Physical harm?:", s(record.daPhysical));
  }
  if (s(record.daPowerControl)) {
    drawTextBlock("Power/control?:", s(record.daPowerControl));
  }
  if (s(record.daFeelSafe)) {
    drawTextBlock("Feel safe to mediate?:", s(record.daFeelSafe));
  }
  if (s(record.daFinancialControl)) {
    drawTextBlock("Financial control?:", s(record.daFinancialControl));
  }
  if (s(record.daPermissionToDecide)) {
    drawTextBlock("Permission to decide?:", s(record.daPermissionToDecide));
  }
  if (s(record.daAfraidOfReaction)) {
    drawTextBlock("Afraid of reaction?:", s(record.daAfraidOfReaction));
  }
  if (s(record.domesticAbuseScreening)) {
    drawTextBlock("Additional screening notes:", s(record.domesticAbuseScreening));
  }
  drawTextBlock("Conclusions affecting mediation / safety measures:", s(record.domesticAbuseSafetyConclusions));

  if (daServices.length > 0) {
    const serviceLabels = daServices.map(svc => {
      const found = DA_SUPPORT_SERVICES.find(d => d.key === svc);
      if (svc === "other" && s(record.domesticAbuseSupportServicesOther)) {
        return `Other: ${s(record.domesticAbuseSupportServicesOther)}`;
      }
      return found ? found.label : svc;
    });
    drawFieldRow("Support services offered:", serviceLabels.join(", "));
  }

  drawFieldRow("Legal aid info (DA):", s(record.domesticAbuseLegalAidInfo));
  if (s(record.domesticAbuseNotes)) {
    drawTextBlock("Notes:", s(record.domesticAbuseNotes));
  }

  drawSectionHeader("12. Emotional Readiness to Engage and Safety During Mediation");
  if (s(record.erEqualBasis)) {
    drawTextBlock("Equal basis?:", s(record.erEqualBasis));
  }
  if (s(record.erChoosingFreely)) {
    drawTextBlock("Choosing freely?:", s(record.erChoosingFreely));
  }
  if (s(record.erPressuredToAttend)) {
    drawTextBlock("Pressured to attend?:", s(record.erPressuredToAttend));
  }
  if (s(record.erCanWithdraw)) {
    drawTextBlock("Can withdraw?:", s(record.erCanWithdraw));
  }
  if (s(record.erSameRoom)) {
    drawTextBlock("Same room comfort?:", s(record.erSameRoom));
  }
  if (s(record.erCapacity)) {
    drawTextBlock("Capacity to engage?:", s(record.erCapacity));
  }
  if (s(record.emotionalReadiness)) {
    drawTextBlock("Additional notes:", s(record.emotionalReadiness));
  }
  drawTextBlock("Safety measures discussed:", s(record.safetyMeasuresDiscussed));
  drawTextBlock("Safety measures agreed:", s(record.safetyMeasuresAgreed));

  drawSectionHeader("13. Issues for Mediation");
  drawIssuesGrid(ISSUES_ITEMS, issues);
  const otherIssueNotes = getVal(issues, "other").notes;
  const otherIssueText = [s(record.issuesOther), otherIssueNotes].filter(Boolean).join("; ");
  if (otherIssueText) {
    drawTextBlock("Other details:", otherIssueText);
  }

  drawSectionHeader("14. Further Information Requested");
  for (const item of FURTHER_INFO_ITEMS) {
    const val = getVal(furtherInfo, item.key);
    const mark = val.status === "yes" ? "X" : " ";
    ensureSpace(14);
    doc.fontSize(8).font("Helvetica").fillColor("black")
      .text(`[${mark}] ${item.label}${val.notes ? ` — ${val.notes}` : ""}`, PAGE_MARGIN + 4, doc.y, { width: pageWidth - 8 });
    doc.moveDown(0.1);
  }
  if (s(record.furtherInfoOther)) {
    drawTextBlock("Other:", s(record.furtherInfoOther));
  }

  drawSectionHeader("15. Mediator's Checklist");
  drawFieldRow("Suitable for mediation?:", s(record.suitableForMediation));
  if (showSuitabilityReasons && s(record.suitabilityReasons)) {
    drawTextBlock("Reasons (not to be communicated with clients):", s(record.suitabilityReasons));
  }
  drawFieldRow("Next steps:", s(record.nextSteps));
  drawFieldRow("Type of mediation:", s(record.mediationType));
  drawFieldRow("Timeline:", s(record.timeline));
  drawFieldRow("Agreed with client?:", formatYesNo(record.agreedWithClient));
  drawFieldRow("OFS required?:", formatYesNo(record.ofsRequired));
  drawFieldRow("MOU required?:", formatYesNo(record.mouRequired));
  drawFieldRow("Statement of child arrangements?:", formatYesNo(record.statementOfChildArrangements));

  doc.moveDown(0.3);
  drawFieldRow("PPC discussion required?:", formatYesNo(record.ppcRequired));
  if (ppcRequiredYes && ppcReasons.length > 0) {
    const ppcReasonLabels = ppcReasons.map(reason =>
      reason === "Other" && s(record.ppcReasonOther)
        ? `Other: ${s(record.ppcReasonOther)}`
        : reason
    );
    drawFieldRow("PPC reason(s):", ppcReasonLabels.join(", "));
  }
  if (ppcRequiredYes) {
    drawFieldRow("PPC discussion date:", s(record.ppcDate));
    drawFieldRow("PPC consultant name:", s(record.ppcConsultantName));
    if (s(record.ppcOutcomes)) {
      drawTextBlock("Key outcomes/guidance from PPC:", s(record.ppcOutcomes));
    }
  }

  doc.moveDown(0.3);
  drawFieldRow("Referral to CAFCASS/Other:", formatYesNo(record.referralToCafcass));
  drawFieldRow("Referral to children's services:", formatYesNo(record.referralToChildrenServices));
  if (referralToChildrenServicesYes && s(record.referralToChildrenServicesDetails)) {
    drawTextBlock("Details:", s(record.referralToChildrenServicesDetails));
  }
  if (referralToChildrenServicesYes) {
    drawFieldRow("Follow up contact required?:", formatYesNo(record.referralFollowUpContact));
  }

  doc.moveDown(0.5);
  ensureSpace(30);
  doc.fontSize(7).font("Helvetica").fillColor(BRAND_GREY)
    .text("Generated by Brighter Future Mediation CRM", PAGE_MARGIN, doc.y, { align: "center", width: pageWidth });
  doc.fontSize(7).font("Helvetica").fillColor(BRAND_GREY)
    .text(`Date: ${new Date().toLocaleDateString("en-GB")}`, PAGE_MARGIN, doc.y, { align: "center", width: pageWidth });

  return doc;
}
