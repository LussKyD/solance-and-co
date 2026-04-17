# Solance & Co — Finance System

A mobile-first finance dashboard for Solance & Co, built as a progressive web app.

## Features
- M-Pesa / SACCO message parser — paste and classify in one tap
- Sales logging with multi-unit cart (onesies + sunglasses)
- Split payment tracking
- Fund allocation — Profit / Restock / Misc
- Delivery income tracking (fee charged vs actual cost)
- Laundry cost tracking (deducted from real profit)
- Customer directory with churn alerts
- Stock level tracking with low-stock alerts
- Restock planner
- Profit account — log monthly transfers out
- Sales velocity and trend indicators
- PDF statement export

## Structure
```
solance-and-co/
├── index.html        ← app shell
├── css/
│   └── style.css     ← all styles
├── js/
│   └── app.js        ← all logic
├── img/              ← assets (future)
└── README.md
```

## Usage
Live at `https://yourusername.github.io/solance-and-co`

Open in Chrome on Android → tap ⋮ → **Add to Home screen**

## Data
Stored locally in the browser via `localStorage`. Nothing sent to any server.
