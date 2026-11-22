# StockSonar PRD

**Project 3 — Dhanraj and Nakul**

StockSonar: An AI Research Copilot That Tells You What Changed and Why

## Problem

Retail investors buy stocks for a reason, then lose track of whether that reason still holds. The signals that matter, like SEC filings, insider trades and earnings news, are free but scattered and hard to read. StockSonar is a research tool, not an advisor: users import their holdings, Claude agents write cited bull and bear reports, a devil's-advocate agent challenges each report, and the app alerts users when news weakens their reason for owning a stock.

## What Makes It Different

AI stock research apps already summarize news and write reports. StockSonar is built around the investor's own reasoning: you record why you own each stock in your own words, and the app tracks evidence for and against that reason. Every report is challenged by a devil's-advocate agent, and every claim links to its source. Investment clubs can research, propose and vote on trades together, which most AI research tools are not built for.

## Target Users

- **Primary:** everyday retail investors in US stocks, starting with students new to investing.
- **Secondary:** investment clubs. An admin creates a club; members propose and vote on trades.

## User Stories

1. As an investor, I want to upload a screenshot or CSV of my holdings, so that I can see my portfolio without typing every position.
2. As an investor, I want a dashboard with value, gain or loss and allocation warnings, so that I understand my risk at a glance.
3. As an investor, I want a report on any stock with a bull case, bear case and cited sources, so that I can judge the evidence myself.
4. As an investor, I want to record why I own each stock and get alerted when news weakens that reason, so that I know when to rethink.
5. As an investor, I want a short morning brief of what changed overnight and why, so that I know what matters today.
6. As a club admin, I want to create a club and invite members, so that our group can manage a shared portfolio.
7. As a club member, I want to propose a trade with a report attached and vote, so that group decisions are based on research.

## Scope

- **MVP:** user stories 1–7 with screenshot and CSV import.
- **Stretch goal:** connecting a brokerage account.
- **Data:** v1 uses only free data sources (SEC EDGAR plus one free market-data/news API).

## Principles

- Research, not advice: the app never tells users to buy or sell.
- Every claim in a report cites a source the app actually fetched.
- The app records club votes but never executes trades or holds money.
