---
"diagnostics-webpack-plugin": patch
---

Run a check the compilation carries nothing of — one whose `reportAs` leaves out both its errors and its warnings, writing no `outputReport` — after a watch rebuild rather than during it, so that the rebuild is over before the check starts and what it finds is printed to the terminal when it lands.
