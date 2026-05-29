---
name: ticket-triage
description: Build ticket-status charts and overviews from live data, never invented numbers.
---

When the user asks for a ticket chart, status overview, or dashboard:

1. ALWAYS call the `get_ticket_stats` tool first to fetch the latest counts. Never invent ticket numbers.
2. Build a bar chart using exactly those counts, with labels `["Open","Pending","Resolved","Closed"]` in that order.
3. Title the chart "Tickets by Status".
4. If no suitable page exists yet, create one with `createPage` (e.g. pageId "reports", title "Reports"), then place the chart in its `top-left` region.
