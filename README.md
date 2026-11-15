# 🌌 Vitals of the Void

<div align="center">

[![NASA Space Apps Challenge 2026](https://img.shields.io/badge/NASA-Space%20Apps%202026-blue?style=for-the-badge&logo=nasa)](https://www.spaceappschallenge.org/)
[![Live Demo](https://img.shields.io/badge/Website-Live%20Demo-success?style=for-the-badge&logo=google-chrome)](https://vitalsofthevoid.health)
[![Status](https://img.shields.io/badge/Status-Operational-brightgreen?style=for-the-badge)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

*An advanced deep-space biomedical telemetry and astronaut health monitoring platform designed for long-duration spaceflight missions.*

</div>

---

## 🚀 Quick Links

* [🌐 Live Application](https://vitalsofthevoid.health)
* [🎯 Challenge Overview](#-about-the-project)
* [✨ Key Features](#-key-features)
* [🛠️ Tech Stack](#️-tech-stack)
* [📦 Installation & Setup](#-installation--setup)

---

## 🎯 About the Project

**Vitals of the Void** is an end-to-end astronaut physiological telemetry platform built for the **2026 NASA Space Apps Challenge**. Long-duration space missions expose astronauts to unique microgravity stressors, fluid shifts, immune dysregulation, and bone density loss. 

Vitals of the Void bridges the gap between deep-space isolation and terrestrial medical oversight by combining real-time vital tracking, microgravity baseline references, AI-driven diagnostics via **MarkerDB 2.0**, and an instant crew-to-Earth emergency response protocol.

---

## ✨ Key Features

* **Dual Operating Modes**: Seamlessly switch between continuous background health monitoring and on-demand clinical assessment modes.
* **MarkerDB 2.0 Integration**: Automatically cross-references physiological anomalies against a specialized database to identify potential medical conditions and provide actionable spaceflight medical guidance.
* **Microgravity & Terrestrial Baselines**: Calibrates telemetry thresholds dynamically, factoring in long-term spaceflight physiological drift versus personalized pre-flight baselines.
* **🚨 TARS Code Red Emergency System**: 
  * Features a prominent top-sidebar red emergency button to instantly alert crewmates and the NASA Earth Command Center.
  * Includes a hands-free voice trigger (**"TARS code red"**) for high-stress or mobility-impaired scenarios.
* **Interactive Telemetry Dashboard**: Space-themed futuristic UI complete with dynamic planetary switching and real-time rate-of-change spike detection.

---

## 🛠️ Tech Stack

* **Frontend**: HTML5, Modern CSS3, JavaScript (Single-File Architecture optimized for performance and reliability)
* **Styling / UI**: Space-themed custom dark/purple UI layout with interactive planetary hero components
* **Intelligence**: Gemini API Integration (`GEMINI_API_KEY`) for advanced diagnostic assistant parsing
* **Hosting**: GitHub Pages (`vitalsofthevoid.health`)

---

## 📦 Installation & Setup

To run a local development copy of Vitals of the Void, follow these steps:

1. **Clone the repository**
   ```bash
   git clone [https://github.com/kimseojun444/Vitals-of-the-Void.git](https://github.com/kimseojun444/Vitals-of-the-Void.git)
   cd Vitals-of-the-Void
