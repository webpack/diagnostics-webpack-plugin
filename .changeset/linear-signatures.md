---
"diagnostics-webpack-plugin": patch
---

Sign the files kept under typed linting in one pass over the import graph rather than walking everything each file imports again for every file, which grew with the square of the project where files import a barrel that imports them back. Over 6,000 such modules, telling which kept results still hold took 27 s a build and now takes 0.13–0.57 s.
