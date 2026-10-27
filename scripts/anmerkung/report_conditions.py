#!/usr/bin/env python3
"""Generate an Anmerkung condition-report PDF from assets/anmerkung.js.

Pulls live constants where possible; the rule cascade text is hand-maintained
here (it documents intent, which code comments don't render to PDF). Rebuild
with: python scripts/anmerkung/report_conditions.py
"""
import json
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(ROOT, "assets", "anmerkung.js")
OUT = os.path.join(ROOT, "docs", "anmerkung", "conditions-report.pdf")
TITLE = "Anmerkung Conditions Report"

# ── grab live constants / threshold defaults from the engine ──
src = open(ENGINE, encoding="utf-8").read()
const = {}
for name in [
    "T_DACHSER", "T_KN", "T_DHL", "T_WACKLER",
    "WACKLER_TZ_ADDITIVE", "WACKLER_SNK_NOISE",
    "WACKLER_EINLAGERUNG_ABS", "WACKLER_EINLAGERUNG_TOL",
    "WACKLER_HEBEBUEHNE_ABS", "WACKLER_HEBEBUEHNE_TOL",
    "WACKLER_PAUSCHAL_RATIO", "WACKLER_SNK_TERMIN80_ABS",
    "WACKLER_SNK_TERMIN80_TOL", "WACKLER_BUENDEL_MAX_KG",
    "WACKLER_XTIER_NEAR_BAND", "WACKLER_BUENDEL_PARTIAL",
    "WACKLER_COLLI_KG", "WACKLER_SAME_WEIGHT_BAND",
    "WACKLER_BUENDEL_NEAR_BAND", "WACKLER_BUENDEL_MIN_REFS",
    "WACKLER_TZ_RATE_TOL", "HONOLD_RATE_TOL",
    "DA_NAT_PRICE_TOL", "DA_NAT_COPY_TOL", "DA_NAT_MAX_COPIES",
]:
    m = re.search(rf"const\s+{name}\s*=\s*([^;]+);", src)
    if m:
        const[name] = m.group(1).strip()
for name in ["dachser", "kn", "dhl", "wackler"]:
    m = re.search(rf"{name}:([\d.]+)", src)
    if m:
        const[f"TH_DEFAULT_{name.upper()}"] = m.group(1)
# The runtime thresholds are aliases of the persisted map (`let T_DACHSER = TH.dachser,
# T_KN = TH.kn, ...`), not literals, so the const scan above never matches them and
# every threshold in the report would render as "?". Resolve each alias to the default
# it starts from.
for fw in ["dachser", "kn", "dhl", "wackler"]:
    m = re.search(rf"(?:let|,)\s*T_{fw.upper()}\s*=\s*TH\.(\w+)", src)
    if m:
        const[f"T_{fw.upper()}"] = const.get(f"TH_DEFAULT_{m.group(1).upper()}", "?")
const["KONTIERUNG_ENABLED"] = "true" if "KONTIERUNG_ENABLED=false" not in src else "false"


def k(name):
    return const.get(name, "?")


# ── styles ──
ss = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=18, spaceAfter=4)
sub = ParagraphStyle("sub", parent=ss["BodyText"], fontSize=9, textColor=colors.HexColor("#888888"), spaceAfter=10)
h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13, spaceBefore=12, spaceAfter=4, textColor=colors.HexColor("#1f3b63"))
h3 = ParagraphStyle("h3", parent=ss["Heading3"], fontSize=10.5, spaceBefore=8, spaceAfter=2, textColor=colors.HexColor("#333333"))
body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=8.8, leading=12, spaceAfter=4, alignment=TA_LEFT)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=2, spaceAfter=2)
code = ParagraphStyle("code", parent=body, fontName="Courier", fontSize=8, leading=10, spaceAfter=4)  # noqa: F841

BB = colors.HexColor("#bfd3ed")
VB = colors.HexColor("#f2f6fb")


def P(text, style=body):
    return Paragraph(text, style)


def bullets(items):
    return [Paragraph(f"•&nbsp; {it}", bullet) for it in items]


# small helper for the constants table per forwarder
def const_table(rows):
    t = Table([["Constant", "Value"], *rows], colWidths=[12.0 * cm, 4.4 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BB),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b7c9df")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, VB]),
    ]))
    return t


def section_table(rows):
    """rows: [(label, detail)] — two-column condition table."""
    t = Table([[Paragraph("<b>Condition</b>", body), Paragraph("<b>Label written to Anmerkung</b>", body)]] + [
        [Paragraph(a, body), Paragraph("<font face='Courier' size='8'>{}</font>".format(b), body)]
        for a, b in rows
    ], colWidths=[8.6 * cm, 7.8 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BB),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b7c9df")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, VB]),
    ]))
    return t


story = []

# ── header ──
story.append(P(TITLE, h1))
story.append(P(
    f"Rule engine covering Dachser, K+N, DHL Express, Wackler &amp; Honold &nbsp;·&nbsp; "
    f"source: assets/anmerkung.js &nbsp;·&nbsp; generated {__import__('datetime').date.today().isoformat()}",
    sub,
))
story.append(HRFlowable(width="100%", thickness=0.8, color=BB, spaceAfter=8))

# ── how it works ──
story.append(P("How a row is classified", h2))
story.append(P(
    "Each worksheet row is read column-wise into the five <i>process*</i> functions. A row is only "
    "classifiable when its <b>Stat_Freigabe</b> cell equals <b>10</b> (released); otherwise the row is "
    "skipped (Wackler still runs its Kontierung check). Each forwarder compares its forwarder-specific "
    "<b>Differenz</b> columns (FR, MT, SNK, EXP, TZ, …) against a <b>firing threshold</b>:"
))
story.append(Paragraph("hasErr(v, t) = |v| > t", code))
story.append(P(
    "A delta that clears the threshold is called a &quot;trigger&quot; and contributes a label. All labels a "
    "row gathers are joined with <b>&quot; // &quot;</b> into the <b>Anmerkung</b> cell (deduplicated by "
    "<code>join</code>). Some rules <i>return early</i> or block later rules, because a single finding "
    "(e.g. a duplicate Fremdnummer booking) makes every other delta on the row spurious."
))
story.append(P("Thresholds", h3))
story.append(const_table([
    ("Firing threshold — Dachser", f"|diff| &gt; <b>{k('T_DACHSER')}</b> (default {k('TH_DEFAULT_DACHSER')})"),
    ("Firing threshold — K+N", f"|diff| &gt; <b>{k('T_KN')}</b> (default {k('TH_DEFAULT_KN')})"),
    ("Firing threshold — DHL Express", f"|diff| &gt; <b>{k('T_DHL')}</b> (default {k('TH_DEFAULT_DHL')})"),
    ("Firing threshold — Wackler", f"|diff| &gt; <b>{k('T_WACKLER')}</b> (default {k('TH_DEFAULT_WACKLER')})"),
    ("Persisted per-user", "localStorage key <font face='Courier' size='8'>anmerkung.thresholds.v1</font>; defaults preserve original behaviour"),
    ("Kontierung? checks", f"disabled globally — KONTIERUNG_ENABLED = {k('KONTIERUNG_ENABLED')}"),
]))

story.append(PageBreak())

# ════════ DACHSER ════════
story.append(P("1. Dachser — processDachser", h2))
story.append(P(
    "Gate: Stat = 10. Reads C502/C503 (Einlagern/Auslagern), SNK, ZZ, SAM, DGR, EXP, MT, TZ, C38L, "
    "FR with weight/tier logic on the DACHSER_BP rate-card tiers (50 kg steps → 10 000 kg, open 999 999 "
    "bucket). Cascade order matters — the first rule that fires colours the rest."
))
story.append(P("1.0 Blank-Tarif accounting rows (early return)", h3))
story.append(section_table([
    ("TARIF cell empty AND |FR| &gt; T; no SACH, no SERV_ART, no other diff (MT/TZ/EXP/SNK/ZZ/DGR/LG/AV/SAM/SBFU/C38L)",
     "VORHOLUNG"),
    ("same empty-TARIF but SACH + SERV_ART are set",
     "Fremdnummer &lt;row's ReferenzNr&gt; bereits berechnet in RE00123xxx, ok? (falls back to the 5034xxx placeholder when ReferenzNr is empty; the Beleg it was charged in stays a placeholder, it names a document outside this workbook)"),
    ("empty TARIF + FR trigger + departure country non-DE", "kein Tarif für &lt;Land&gt;"),
    ("empty TARIF + FR trigger + domestic lane above 10 t (Brutto kg &gt; 10000)", "Kein Tarif für DE &gt;10 to, ok?"),
    ("FR, MT and TZ all &lt; &minus;T while Volumen kg = 0 and Volumen kg DL = 0 (the invoice bills the shipment together with another one)", "zusammengefasste Abrechnung (early return, checked after the blank-TARIF block)"),
]))
story.append(P("1.1 Direct-cost labels (each fires independently)", h3))
story.append(section_table([
    ("C196 Differenz over threshold (Kalkulationskosten)", "Kalk. Kosten Zustellung (emitted as the leading segment)"),
    ("C502 Kosten DL has a non-zero value", "Einlagern"),
    ("C503 Kosten DL has a non-zero value", "Auslagern"),
    ("LG Differenz over threshold", "Lagergeld"),
    ("AV Differenz over threshold", "Gebühr für vergeblichen Abholversuch"),
    ("ZZ Differenz over threshold", "2. Zustellung"),
    ("SAM Differenz over threshold", "Samstagzustellung"),
    ("DGR Differenz over threshold (skipped when TARIF is zero)", "Gefahrgut-Zuschlag"),
    ("EXP Differenz over threshold", "Produktzuschlag, or Terminzuschlag when EXP Kosten DL = 95"),
    ("ZABF Differenz over threshold", "Einfuhrzollabfertigung"),
    ("SBFU Differenz over threshold", "SBfU-Bescheinigung f. Umsatzsteuerzwecke"),
    ("C38L Differenz over threshold", "Maut von/bis NL"),
]))
story.append(P("1.2 SNK — switch on billed SNK_DL", h3))
story.append(section_table([
    ("SNK_DL = 190 or 95", "AUSFALLFRACHT"),
    ("SNK_DL = 130", "Standgeld; SERV_ART = K1AV → Wartezeit 2h &aacute; 65 EUR, ok? (2 × 65)"),
    ("SNK_DL = 390", "Standgeld (three 130 units, also on K1AV)"),
    ("SNK_DL = 75 + SNK_TARIF &gt; 0 + SNK diff over T", "Differenz Hebebuehnen-Zuschlag"),
    ("SNK_DL = 75 + SERV_ART = K1AV", "Speditionskosten gem. Text"),
    ("SNK_DL = 75 (no tariff backing)", "Ausfallfracht/Schadensersatz"),
    ("SNK_DL = 80 + SERV_ART = K1AV", "Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel"),
    ("SNK_DL = 210 + SERV_ART = K1AV", "Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag // Speditionskosten gem. Text // Wartezeit 2h &aacute; 65 EUR, ok? (210 = 5 + 75 + 2 × 65)"),
    ("SNK_DL = 11 (+ diff over T)", "Differenz Telefonische Zustellankündigung - Laderaumzuschlag"),
    ("SNK_DL = 14 (+ diff over T, TARIF not zero)", "Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag (K1AV → Differenz Laderaumkostenentwicklung)"),
    ("SNK_DL = 5 + SERV_ART = K1AV (SNK_TARIF=0)", "Admin Zeitfensterbuchung Handel"),
    ("SNK_DL = 5 + SERV_ART = K1AV (SNK_TARIF&gt;0)", "Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag"),
    ("SNK_DL = 5 + diff over T + domestic lane (Abg.-Land blank or DE); skipped when TARIF zero", "Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag"),
    ("SNK_DL = 5 + diff over T + import lane (Abg.-Land not DE, Empf.-Land DE)", "Differenz Laderaumkostenentwicklung"),
    ("SNK_DL = 9 (+ diff over T, TARIF not zero)", "Differenz Telefonische Zustellterminvereinbarung - Laderaumzuschlag"),
    ("other SNK_DL + SERV_ART = K1AV, or non-integer SNK_DL whose SNK_DIFF &gt; T (a residual equal to the 0.08 threshold does not qualify)", "Differenz Laderaumkostenentwicklung"),
    ("K1AV and SNK_DL is a whole 65-multiple (&ge; 65) and not SNK_DL = 390", "Wartezeit &lt;n&gt;h &aacute; 65 EUR, ok? (the headline alone, no admin-fee suffix)"),
    ("K1AV and SNK_DL &minus; 5 &ge; 65, residual a whole 65-multiple", "Wartezeit &lt;n&gt;h &aacute; 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag (the bundled admin fee is still owed, so the phrase is not emitted alone)"),
    ("K1AV and SNK_DL &gt; 500 with SNK_TARIF = 0 or SNK_TARIF = TARIF, when SNK_DL is not a whole 65-multiple and SNK_DL &minus; 5 is not a whole 65-multiple (the two Wartezeit rows above win first)", "&lt;SNK_DL&gt; Kosten f&uuml;r 2.Zustellung etc. ok? (the billed amount itself, no 5 EUR deduction; an integer amount renders without cents, e.g. \"921\")"),
    ("K1AV and SNK_DL &minus; 5 &ge; 65, residual cents-bearing and not a 65-multiple, with SNK_DL &le; 500 or a separate SNK tariff base (SNK_TARIF ≠ 0 and ≠ TARIF)", "&lt;SNK_DL &minus; 5&gt; Kosten f&uuml;r 2.Zustellung etc. ok?"),
    ("other SNK_DL (+ diff over T)", "Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag"),
    ("Non-integer SNK_DL and SNK_DIFF rounds to 5/9/11/14 (±0.05)", "code re-derived from SNK_DIFF, then the switch above"),
]))
story.append(P("1.3 EXP + others", h3))
story.append(section_table([
    ("EXP diff over T and EXP_DL = 95", "Terminzuschlag"),
    ("EXP diff over T (otherwise)", "Produktzuschlag"),
    ("Empf.-Ort = LONDON, PLZ leading letter", "Zone korrekt berechnet? (+ Einfuhrzollabfertigung when EXP clean)"),
    ("ZABF Differenz over threshold (Import-Zollabfertigung line)", "Einfuhrzollabfertigung"),
]))
story.append(P("1.4 FR — weight/tier decision tree (after SNK)", h3))
story.append(section_table([
    ("SERV_ART = K1AU and the rate cards return Sonderfahrt for the lane (FR Kosten DL &minus; 180/150/120/90/110 lands on a NEW-card cell)", "Sonderfahrt"),
    ("Anz. Sdg &gt; 1 (multi-consignment)", "hätte gebündelt werden können?"),
    ("REFERENZ3 = ZW (deviating intermediate consignee)", "Differenz aufgrund abweichender Zwischenempfänger &lt;PLZ Ort&gt;"),
    ("SERV_ART = K1AS", "Sonderfahrt"),
    ("SERV_ART = K1AU and |FR − 90| ≤ 0.1", "\"Sonderfahrt\" 90 EUR doppelt berechnet?"),
    ("domestic (DE to DE) row whose FR Kosten lt. Tarif is the national-card cell for its Empf.-PLZ zone and weight bracket, and whose FR delta is 1 to 4 whole zone prices with a unique count", "Referenz wird N+1x abgerechnet"),
    ("weights known, same tier, T &lt; FR &lt; 1.0, |Brutto kg &minus; Volumen kg DL| &ge; 0.05, no other label", "Differenz aufgrund abweichender Gewichte"),
    ("weights equal or same tier; FR &gt; 1 on an international lane (non-DE origin or destination)", "Sonderfahrt, or Dachser berechnet die Kosten nach dem bisherigen Tarif &mdash; decided by the rate cards: (FR Kosten DL &minus; S) landing on a NEW-card cell for S in 180/150/120/90/110 gives Sonderfahrt, otherwise FR Kosten lt. Tarif landing on an OLD-card cell (timed by 1.15 on imports) gives the bisherigen wording. Ratecards are encrypted (assets/dachser-ratecards.enc.json); without the passphrase the bisherigen wording stands."),
    ("weights equal or same tier; FR &gt; 1 (or ≥ 0.05 with no other label); ZZ diff = 35", "Fracht Differenz (ZZ=35)"),
    ("weights equal or same tier; FR &gt; 1 (or ≥ 0.05 with no other label); otherwise", "Frachtdifferenz"),
    ("weights equal or same tier; FR &lt; −1.0", "Differenz aufgrund abweichender Gewichte"),
    ("both weights known, different tier, FR 0–1", "Frachtdifferenz"),
    ("both weights known, different tier (FR ≥ 1 or negative)", "Differenz aufgrund abweichender Gewichte"),
    ("no weight basis, FR negative (or &lt; 1.0)", "Differenz Frachtzu/ abschlag"),
    ("no weight basis, FR positive", "Differenz aufgrund von abweichendem Gewicht"),
]))
story.append(section_table([
    ("SNK_DL = 14 + SNK diff over T (footer)", "Abholterminvereinbarung"),
    ("row has no other label, only TZ over T", "Differenz treibstof"),
]))
story.append(P("Referenz-count constants (national card + PLZ zone table)", h3))
story.append(const_table([
    ("FR Kosten lt. Tarif vs the zone ladder cell of the row's weight bracket", k("DA_NAT_PRICE_TOL")),
    ("one billed copy vs a zone price (any bracket of the zone)", k("DA_NAT_COPY_TOL")),
    ("copies searched above the tariff copy", k("DA_NAT_MAX_COPIES")),
]))

story.append(PageBreak())

# ════════ K+N ════════
story.append(P("2. K+N — processKN", h2))
story.append(P(
    "Gate: Stat = 10. Tiers from KN_BP (like Dachser but collapses the 8500/9500 steps and opens at 99 999). "
    "FR (freight) is the lead column; EXP/MT/SNK/TZ add their own labels."
))
story.append(section_table([
    ("FR over T and ReferenzNr lists multiple docs (contains ',') — early return", "hätte gebündelt werden müssen, ok?"),
    ("FR over T, TARIF blank or '-' — flat-rate freight", "Pauschalfracht"),
    ("FR over T, Amazon recipient, VKG and VKG_DL in the same weight tier", "hätte nach Amazon Tarif abrechnen müssen"),
    ("FR over T, Amazon recipient, VKG and VKG_DL cross tiers", "Differenz aufgrund abweichender Gewichte"),
    ("FR &gt; 0 and SNK_DL = 5, same tier", "hätte nach Amazon Tarif abrechnen dürfen"),
    ("FR &gt; 0 and SNK_DL = 5, cross tier", "Differenz aufgrund abweichender Gewichte"),
    ("any other FR over T", "Differenz aufgrund abweichender Gewichte"),
    ("EXP over T", "FIXTERMIN"),
    ("MT over T", "Mautdifferenz"),
]))
story.append(P("SNK cascade — exact matches first, then tolerance fallback", h3))
story.append(section_table([
    ("SNK diff ≈ +9", "Avis, ok?"),
    ("SNK diff ≈ −9", "Differenz avis"),
    ("|SNK diff| ≈ 25", "Portalavisierung, ok?"),
    ("SNK diff over T and SNK_DL = 5 or 25", "Portalavisierung, ok?"),
    ("SNK diff over T and SNK_DL = 9", "Avis, ok?"),
    ("SNK diff over T and SNK_DL = 12", "B2C-zuschlag, ok?"),
    ("SNK diff over T and SNK_DL = 18 (unless Avis already)", "Avis, ok?"),
    ("SNK diff over T and SNK_DL = 34", "Portalavisierung, ok? // Avis, ok?"),
    ("SNK diff over T, code not matched", "SNK Differenz"),
    ("TZ over T AND neither FR nor MT fired", "Differenz treibstoff"),
    ("KOST or SACH blank/'−' (disabled)", "Kontierung?"),
]))

story.append(PageBreak())

# ════════ DHL ════════
story.append(P("3. DHL Express — processDHL", h2))
story.append(P(
    "Gate: Stat = 10. Uses a <b>blocking chain</b>: the first group (EL/FR/PAL/OW/YO/YL/ND/SF + SNK) sets "
    "<code>block</code>, and only when nothing blocked does the AC/MT/NX/OS group fire."
))
story.append(section_table([
    ("TARIF present but value 0 (raw contains '0' or is '-')", "Fremdnummer xxx bereits berechnet in RExxx, ok?."),
    ("EL Differenz over T", "EXTENDED LIABILITY, ok?"),
    ("FR Differenz over T", "Differenz aufgrund von abweichendem Gewicht/Volumen"),
    ("PAL Differenz over T", "nicht stapelbar ok?"),
    ("OW Differenz over T", "Differenz overweight, ok?"),
    ("YO positive and divisible by 15", "Non conveyable piece-weight ok?"),
    ("YO over T (not a 15-multiple)", "non conveyable piece ok?"),
    ("YL over T", "Non-conveyable piece irregular ok?"),
    ("ND over T", "Neutral delivery ok?"),
    ("SF over T", "Direct signature ok?"),
    ("SNK = 5", "DIRECT SIGNATURE , ok?"),
    ("SNK = 25", "Limited quantities ok?"),
    ("SNK = 30", "Elevated Risk, ok?"),
    ("SNK = 60", "Eelevated risk ok? // Restricted destination ok?"),
    ("SNK over T, code not matched", "SNK Differenz"),
    ("below-block group — AC = 11", "Addres Correction, ok?"),
    ("below-block group — AC over T", "Address Correction ok?"),
    ("below-block group — MT over T", "Mautdifferenz"),
    ("below-block group — NX over T", "demand surcharge ok?"),
    ("below-block group — OS over T", "Oversize piece ok?"),
    ("no other label, TZ over T only", "Differenz treibstof"),
]))

story.append(PageBreak())

# ════════ WACKLER ════════
story.append(P("4. Wackler — processWackler", h2))
story.append(P(
    "Gate: Stat = 10 (otherwise only the Kontierung check runs). Numbered rules evaluated in "
    "order with several early returns. Weight-tier logic uses the Wackler rate-card breakpoints "
    "(50 kg steps → 10 000 kg, open 999 999 bucket) shared by the national and international rate sheets."
))
story.append(P("Terminal (early-return) rules", h3))
story.append(section_table([
    ("Empf.-PLZ 88499 and Empf.-Ort RIEDLINGEN with a non-hub Abg.-PLZ (return hub, keyed on the recipient) - first rule, no exceptions: every other phrase is suppressed, since the freight/maut/fuel gaps are return artefacts; a row that starts AND ends at the hub is outbound, not a return", "Return, ok?"),
    ("TARIF '-' or '0' (non-empty), or blank + FR/MT/TZ signal — duplicate booking; all delta rules suppressed", "Fremdnummer &lt;row's ReferenzNr&gt; bereits berechnet in RExxx, ok? (first comma-separated token; the xxx literal when ReferenzNr is blank; the Beleg stays a placeholder, it names a document outside this workbook)"),
    ("TARIF blank + SNK signal + no FR/MT/TZ + no known SNK/AVIS code — storage fee", "Lagergeld, ok?"),
    ("SNK &gt;= 1.0 × TARIF + no FR/MT/TZ + no codes (placeholder tariff)", "Pauschalfracht, ok?"),
    ("|FR Differenz| &gt; T and the MT, SNK, TZ and AVIS Differenz cells all hold exactly zero - the freight is the only cost delta, sign-agnostic; all delta rules suppressed", "Pauschalfracht, ok?"),
    ("|FR Differenz| = 250.00 ± 0.5 and the MT, SNK, TZ and AVIS Differenz cells all hold exactly zero - the 250 € surcharge billed on the freight line instead of the SNK line; one finding, both axes, sign-agnostic", "Zusatzkosten 250 €, ok?"),
]))
story.append(P("AVIS surcharge codes", h3))
story.append(section_table([
    ("AVIS = 7.5 / 8.5 / 6.5 / 8.7 (sign-insensitive)", "Avis, ok?"),
    ("AVIS = −8.7 (should have used the cheap telephonic rate)", "hätte Avisgebühr telefonisch abrechnen dürfen"),
    ("AVIS = 1 (per-shipment Avisnachweis line)", "Differenz avis, ok?"),
]))
story.append(P("SNK surcharge code book (sign-insensitive, tolerance ±0.5)", h3))
story.append(section_table([
    ("SNK ≈ 38", "NL-FIX"),
    ("SNK ≈ 11.5 (±0.1)", "hätte B2C-Line abrechnen dürfen"),
    ("SNK ≈ 22", "2. Zustellung ok?"),
    ("SNK ≈ 25", "Terminzustellung"),
    ("SNK ≈ 80 on a weighed shipment (weight-gated)", "Terminzustellung"),
    ("SNK ≈ 170", "Terminzustellung"),
    ("SNK ≈ 180", "Terminzustellung, ok?"),
    ("SNK ≈ 43", "2.Zustellung ok?"),
    ("SNK ≈ 289", "Umverfügung"),
    ("SNK ≈ 49", "NL-12, ok?"),
    ("SNK ≈ 113", "NL-SPEZ, ok?"),
    ("SNK ≈ 16", "NIGHTFIX"),
    ("SNK ≈ 81", "NL-10, ok?"),
    ("SNK ≈ 250", 'Zusatzkosten 250 €, ok?'),
]))
story.append(P("Gewichte / bundling decision tree (FR + both weights real)", h3))
story.append(section_table([
    ("multi-ref, weights 1–5% apart (same or cross tier)", "hätte gebündelt werden müssen (alone)"),
    ("VKG and VKG_DL in different rate tiers", "Differenz aufgrund abweichender Gewichte"),
    ("same tier, ≥ 6 references", "hätte gebündelt werden müssen (alone)"),
    ("pallet volume (colli×285) ≥ 10 000 kg or ≥1.05×VKG, tiers apart", "Differenz aufgrund abweichender Gewichte"),
    ("same tier, ≥ 3 references (fallback)", "Differenz aufgrund abweichender Gewichte"),
    ("otherwise (same-tier rate-card case)", "Wackler rechnet Frachtrate für &lt;tier&gt;kg ab"),
    ("cross-tier, multi-ref, VKG_DL ≤ 20% of VKG — TERMINAL", "hätte gebündelt werden müssen (alone)"),
    ("cross-tier, multi-ref, FR &gt; 0, weights within 20%", "hätte gebündelt werden müssen (alone)"),
    ("cross-tier, far weights or FR credit", "Differenz aufgrund abweichender Gewichte"),
    ("same-tier multi-ref with unequal whole-kg weights", "hätte gebündelt werden müssen (alone)"),
    ("same-tier multi-ref with (near-)identical weights, non-integer (volumetric) VKG", "Wackler rechnet Frachtrate für &lt;floor tier&gt;kg ab"),
    ("no real weights + multi-ref + FR", "hätte gebündelt werden müssen (alone)"),
]))
story.append(P("Fallback / additive rules", h3))
story.append(section_table([
    ("FR over T, no Gewichte/bundling fired", "Frachtdifferenz"),
    ("MT over T", "Mautdifferenz"),
    ("|SNK| ≥ 5.0, unrecognised code, not bundled, and no weight/bundling phrase fired", "SNK Differenz, not the 70 € Einlagerung pair"),
    ("|SNK| = 70 ± 0.5 with no FR/MT/TZ/AVIS delta and no other finding - the owner reads the 70 € sum as the 40 + 30 storage fee pair", "Einlagerung 40 €, ok? // Einlagerung 30 €, ok?"),
    ("SNK ≈ −150 (±2)", "hätte Hebebühne abrechnen dürfen"),
    ("|TZ| ≥ 2.0, both sides carry a DIFFERENT fuel rate (|TZ_DL/FR_DL − TZ_Tarif/FR_Tarif| &gt; 0.005; a row or layout without both fuel rates keeps the plain threshold), not on same-tier 'Wackler rechnet' row, not an FR credit - 'Differenz treibstoff' when the fuel gap is the row's only finding, 'Differenz Energiezuschlag' when an FR, MT, SNK, AVIS, weight or bundling phrase fired as well; a Hebebühne credit row queries the surcharge instead", "Differenz treibstoff / Differenz Energiezuschlag / Dieselzuschlag ok?"),
    ("NL-FIX + FR + blank KOST/SACH — 'Zone korrekt?' prepended, Frachtdifferenz stripped", "Zone korrekt? // …"),
    ("only rule left is TZ over T, no other phrase fired", "Differenz treibstoff"),
    ("KOST &amp; SACH both blank/X (disabled)", "Kontierung?"),
]))

story.append(Spacer(1, 6))
story.append(P("Wackler constants", h3))
story.append(const_table([
    ("|TZ| trigger (rule 10)", k("WACKLER_TZ_ADDITIVE")),
    ("TZ/FR rate band: inside it the fuel delta is derived (rule 10)", k("WACKLER_TZ_RATE_TOL")),
    ("|SNK| noise floor (rule 9)", k("WACKLER_SNK_NOISE")),
    ("SNK ≈ −150 ± 2 → Hebebühne", f"{k('WACKLER_HEBEBUEHNE_ABS')} ± {k('WACKLER_HEBEBUEHNE_TOL')}"),
    ("SNK ≈ 70 ± 0.5 on a quiet row → Einlagerung pair", f"{k('WACKLER_EINLAGERUNG_ABS')} ± {k('WACKLER_EINLAGERUNG_TOL')}"),
    ("SNK ≥ ratio × TARIF → Pauschalfracht", f"× {k('WACKLER_PAUSCHAL_RATIO')}"),
    ("SNK ≈ 80 ± 0.5 → Terminzustellung (weighed)", f"{k('WACKLER_SNK_TERMIN80_ABS')} ± {k('WACKLER_SNK_TERMIN80_TOL')}"),
    ("Multi-ref same-tier upper bundle weight", k("WACKLER_BUENDEL_MAX_KG")),
    ("Cross-tier near band (bundling)", k("WACKLER_XTIER_NEAR_BAND")),
    ("VKG_DL ≤ fraction of VKG → terminal bundling", k("WACKLER_BUENDEL_PARTIAL")),
    ("Pallet volume estimate per collium (kg)", k("WACKLER_COLLI_KG")),
    ("'Near-equal' weights band", k("WACKLER_SAME_WEIGHT_BAND")),
    ("Close-but-unequal bundle band", k("WACKLER_BUENDEL_NEAR_BAND")),
    ("Same-tier ≥ N references → bundling", k("WACKLER_BUENDEL_MIN_REFS")),
]))

story.append(PageBreak())

# ════════ HONOLD ════════
story.append(P("5. Honold — processHonold", h2))
story.append(P(
    "Gate: Stat = 10, plus the OLD tariff must be unlocked and complete (tiers, zone rates, country codes). "
    "The tariff matrix is business data and ships encrypted (<code>assets/honold-tariff.enc.json</code>); "
    "until it is decrypted the engine "
    "<i>skips</i> Honold rows (null) rather than blanking an existing note it cannot re-derive. "
    "Three rules, decided from FR Kosten DL and FR Kosten lt. Tarif. "
    "A ZZ cost line is a second delivery attempt billed on its own: when its Differenz clears the Dachser "
    "difference threshold (T_DACHSER, " f"{k('T_DACHSER')} by default) and FR Kosten DL is blank / 0, the whole note is "
    "&quot;2. Zustellung&quot;. A row that carries freight as well as a ZZ charge is decided by the rules below. "
    "FR Kosten lt. Tarif blank / 0 with an Empf.-Land reads &quot;Kein Tarif für '&lt;LAND&gt;'&quot; and nothing else: "
    "the current tariff prices no lane for that country, so the OLD matrix cannot speak to it. "
    "Otherwise FR Kosten DL is matched against the OLD tariff. The row keeps the previous-tariff note when it "
    "equals a zone rate published for its Empf.-Land in the Bis bracket its Volumen kg falls in (every zone of "
    "the country is a candidate, because the row carries the country but not the zone, and a country's zone "
    "columns can repeat one amount across neighbouring brackets - the AT tail from 6500 kg up is flat, GB3 "
    "repeats at 450/500, MD at 50/100 - which is harmless because only the bracket the row's own Volumen kg "
    "falls in is compared), and "
    "that arm suppresses the weight half whatever Volumen kg DL says. A second arm joins both phrases: FR Kosten DL "
    "is an OLD amount for the country from another bracket, Volumen kg DL is present in a bracket other than "
    "Volumen kg's, and every OLD rate the country publishes at the billed bracket differs from the row's own "
    "FR Kosten lt. Tarif by more than " f"{k('HONOLD_RATE_TOL')} - a proxy for the current matrix, which is not shipped, "
    "so a lane whose OLD and current rates agree at the billed bracket but diverge at the bracket the billed "
    "amount came from can read wrong. Volumen kg DL is read only by that arm; it is never a tier of its own."
))
story.append(section_table([
    ("the OLD tariff is locked / incomplete, or Stat_Freigabe is not 10", "row skipped (null, no note written)"),
    (f"ZZ Differenz above the Dachser difference threshold ({k('T_DACHSER')} by default) and FR Kosten DL blank / 0", "2. Zustellung"),
    ("FR Kosten DL blank / 0 without that ZZ fee", "Differenz aufgrund abweichender Gewichte"),
    ("FR Kosten lt. Tarif blank / 0 and an Empf.-Land is present (an absent column leaves the rule off)", "Kein Tarif für '&lt;LAND&gt;'"),
    ("no / 0 Volumen kg", "Differenz aufgrund abweichender Gewichte"),
    ("FR Kosten DL equals an OLD-tariff rate for the row's Empf.-Land in the Bis bracket its Volumen kg falls in", "Honold berechnet die Kosten nach dem bisherigen Tarif"),
    ("FR Kosten DL equals an OLD-tariff rate of another bracket, Volumen kg DL > 0 sits in yet another bracket, and every OLD rate at the billed bracket differs from FR Kosten lt. Tarif", "Differenz aufgrund abweichender Gewichte // Honold berechnet die Kosten nach dem bisherigen Tarif"),
    ("FR Kosten DL matches no OLD-tariff rate for the row's Empf.-Land, or the country has no zone column", "Differenz aufgrund abweichender Gewichte"),
]))
story.append(P("Honold constants", h3))
story.append(const_table([
    ("Weight brackets", "Bis column of the OLD tariff (50 … 10 000, last row open above)"),
    ("Rate equality tolerance (OLD-tariff match and the KEIN zero test)", k("HONOLD_RATE_TOL")),
]))

story.append(PageBreak())

# ════════ OUTPUT/VALIDATION ════════
story.append(P("How the output is consumed", h2))
story.append(P(
    "The <b>Anmerkung</b> cell is a ' // '-joined list of independent rule outputs. The diff tooling "
    "(<code>classifyDiff</code>) compares the engine output against the auditor's ground-truth column "
    "after normalising phrase spelling/case/whitespace (<code>normPhrase</code>), and buckets each row "
    "as <b>correct / missed / overfired / wrong</b>. Phrase-level decomposition then reports which "
    "specific phrase the engine missed (<i>missing_phrases</i>) and which it over-fired "
    "(<i>extra_phrases</i>). That comes right from the A/B training pairs — a rule change is only "
    "accepted when it re-validates against the git-ignored Soll-Ist workbooks."
))
story.append(P(
    "Control surface: <code>scripts/anmerkung/verify.mjs</code> smoke-tests that the five process* "
    "functions and <code>window.AnmerkungV5</code> exist; the same periods feed the diagnostics facade. "
    "Firing thresholds and the Wackler constants above are read live out of assets/anmerkung.js at "
    "build time, so this report tracks the engine — but the cascade descriptions are maintained by hand "
    "in scripts/anmerkung/report_conditions.py and should be kept in sync when rules change."
))

doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=1.6 * cm, rightMargin=1.6 * cm, topMargin=1.4 * cm, bottomMargin=1.4 * cm,
    title=TITLE, author="Graphify / vb-code-vault",
)


def footer(canvas, doc_):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#999999"))
    canvas.drawString(1.6 * cm, 0.7 * cm, TITLE)
    canvas.drawRightString(A4[0] - 1.6 * cm, 0.7 * cm, f"page {doc_.page}")
    canvas.restoreState()


doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"wrote {OUT}")