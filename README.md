# Trading App Data Explorer

This repository contains the core data-parsing and signal-generation logic for a crypto "confidence" backtesting tool. The React UI lets you upload historical candles (Binance export or a headered CSV), computes several indicators, and highlights high-confidence buy windows.

## Features
- **Flexible CSV ingestion** – accepts Binance kline exports (array rows) or headered CSV files with date/open/high/low/close/volume columns. The parser normalises multiple timestamp formats, including Unix epochs, ISO strings, and Excel serial dates.
- **Daily indicator engine** – resamples 1h candles to UTC days and derives Bollinger Bands, MACD, multi-length SMAs, RSI, and price-to-intrinsic (PI) metrics.
- **Row-level signal expansion** – projects daily indicators back onto the raw 1h cadence, combines them with volume spread analysis (VSA) signals, and computes independent slider-weighted confidence scores.
- **Charting toolkit** – includes reusable Recharts components for price, RSI, MACD, and a table showing the strongest recent buy signals.

## Repository layout
```
src/
  app/            # Top-level React application (state, parsing, scoring)
  charts/         # Recharts visualisations (PriceChart, RsiChart, MacdChart, BuyTable)
  data/           # CSV parsing helpers and resampling utilities
  engine/         # Signal construction and confidence scoring
  indicators/     # Indicator math (daily + helpers)
  main.jsx        # React bootstrap entry point
```

## Usage
The repository currently only includes the source files. To run the UI you can drop the `src/` directory into a React tooling scaffold (e.g. [Vite](https://vitejs.dev/) or Create React App):

```bash
npm create vite@latest trading-app -- --template react
cd trading-app
# replace the generated src/ with the one from this repository
rm -rf src
cp -R /path/to/Trading-App/src ./src
npm install
npm run dev
```

Upload a CSV to view the computed indicators and signal tables. Adjust the sliders to rebalance each signal's weight.

## Contributing
1. Create a feature branch from `work`.
2. Make your changes and add accompanying documentation/tests where possible.
3. Run the development server (`npm run dev`) or your preferred build to verify the UI.
4. Submit a pull request describing the changes and testing performed.

