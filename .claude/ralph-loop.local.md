---
active: true
iteration: 1
max_iterations: 0
completion_promise: null
started_at: "2026-01-21T15:38:08Z"
---

Please fix all the problems with the building and especially block generation. And write some tests that make sure what the code generates is actually valid, so it should check the min and max building size, if there are no by road surrounded spaces that are too small to contain a block, if there are blocks that are too small to fit a building...
And also change some of the parameters, it should be min building size by area, max building size by area, but also a min-edge length for buildings, so i dont want buildings that have a side that is only 0.5 meters. And also make sure there are no angles below a certain angle, lets say 30degrees, but you can also add that to be configurable.
