<p align="center">
  <img src="image_6be93d.png" alt="Vitals in the Void Logo" width="220" />
</p>

# Vitals in the Void

> **NASA Space Apps Challenge 2026** — *Health Monitoring Software Challenge*  
> An advanced astronaut health monitoring, physiological forecasting, and intelligent medical support system engineered for long-duration spaceflight, deep-space transit, and planetary exploration.

---

## 🛑 The Problem: Medical Autonomy in Deep Space

As humanity ventures further into the solar system with Artemis lunar outposts and Mars transit missions, crews face an unprecedented challenge: **severe communication latency**. 

* **Communication Delays**: Radio signals between Mars and Earth experience round-trip communication delays of up to 48 minutes, rendering real-time physician oversight from Mission Control impossible during critical medical events.
* **Microgravity & Environmental Hazards**: Long-duration spaceflight subjects the human body to extreme physiological stressors, including fluid shifts, cardiovascular deconditioning, bone mineral density loss, spaceflight-associated neuro-ocular syndrome (SANS), sleep debt, and ionizing radiation.
* **Acute Emergencies**: In-flight emergencies such as decompression sickness during EVAs, toxic cabin $\text{CO}_2$ spikes, or sudden radiation solar particle events require instant, autonomous diagnostic triage and mitigation without terrestrial intervention.

---

## ⚙️ Our Working Process

To build a mission-critical platform capable of operating autonomously in deep space, our development process integrated empirical aerospace medicine with cutting-edge software architecture:

1. **Biomedical Data Ingestion & Baselines**: We synthesized extensive data from NASA's Human Research Program (HRP) and microgravity biomarker studies—covering ocular changes, plasma volume contraction, bone mineral loss, and circadian disruption—into structured operational datasets.
2. **Predictive Modeling & Drift Analysis**: We developed algorithmic forecasting models that simulate 24-to-48-hour physiological drift vectors, enabling crew members and onboard systems to anticipate adverse health trends before acute symptoms manifest.
3. **AI-Driven Clinical Decision Support**: We integrated the Google GenAI SDK (`@google/genai`) to power **TARS**, an intelligent, calm, and dry-witted spacecraft AI companion capable of multimodal telemetry analysis, voice-activated emergency triage, and hands-free medical protocol guidance.
4. **Extreme Environment UI/UX Design**: Engineered with a high-contrast "liquid-glass" interface optimized for low-light spacecraft decks, high-stress emergency scenarios, and rapid one-touch activation for suited astronauts.

---

## 🚀 The Solution: Vitals in the Void Platform

**Vitals in the Void** is a comprehensive, full-stack health telemetry and decision support platform that bridges the gap between terrestrial medicine and deep-space autonomy.

### Key Capabilities

* **Interactive Body System Monitor**: Real-time tracking across 14+ physiological systems (Brain/Sleep, Eyes/SANS, Cardiovascular, Bones, Fluid Shifts, Muscles, Metabolism, Immune, Radiation, Blood/Anemia, Vasculature, Nutrition, Endocrine, and EVA Hazards) with instant risk categorization and mitigation guides.
* **TARS AI Companion**: Multimodal voice and chat interface providing real-time physiological interpretations, automated medical logging, and instant activation of Code Red emergency protocols (e.g., hypoxia, DCS, radiation alerts).
* **Physiological Drift Vector Forecasting**: Predictive simulation engine forecasting 24–48 hour health trajectories under variable spaceflight hazards (e.g., solar particle events, elevated $\text{CO}_2$, sleep deprivation).
* **EVA & Decompression Triage**: Specialized telemetry tracking for spacewalks, monitoring oxygen prebreathe status, suit $\text{CO}_2$, heart rate limits, and rapid DCS symptom logging.
* **Skin-Diagnostic Triage Assistant**: Clinical decision support tool for evaluating cabin dryness, contact dermatitis, suit friction injuries, and dermatological anomalies during long missions.

---

## 📊 Empirical Microgravity Biomarkers

The platform continuously evaluates crew vitals against established spaceflight thresholds:

| Physiological System | Biomarker | Terrestrial Baseline | Short Duration (<30 Days) | Long Duration (>30 Days) |
| :--- | :--- | :--- | :--- | :--- |
| **Ocular & Neuro-Ocular** | Optic Nerve Sheath Diameter (ONSD) | 4.64–5.8 mm | Baseline | 7.2 ± 1.5 mm |
| **Ocular & Neuro-Ocular** | Visual Acuity | 20/20 | 23–29% deficit | 48–60% deficit |
| **Cardiovascular** | Total Plasma / Blood Volume | ~5 L (Plasma ~3 L) | -10% to -15% | -10% to -15% |
| **Bone & Mineral** | Bone Mineral Density (Hip) | T-score > -1.0 | 0% | -1% to -1.5% / month |
| **Sleep** | Actigraphy Sleep Duration | ~8 h | ~6 h | 5.96 h average |
| **Musculoskeletal** | Muscle Volume / CSA | 100% | -5% | -10% to -20% |
| **Radiation** | Absorbed Dose Rate | ~3 mSv/year | ~0.5–1.0 mSv/day | ~75–150 mSv / 6 mo |
