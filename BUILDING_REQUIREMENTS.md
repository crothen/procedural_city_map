# Building Generation Requirements

## CRITICAL - NON-RECTANGULAR BUILDINGS

**EACH CORNER MUST HAVE INDEPENDENT DEPTH CALCULATION!**

```
depthLeft ≠ depthRight  // DIFFERENT values create trapezoids/parallelograms!
backLeft = frontLeft + inward * depthLeft
backRight = frontRight + inward * depthRight  // NOT the same depth!
```

If both corners use the same depth, buildings will be rectangular. THIS IS WRONG.

## Key Rules - DO NOT FORGET

1. **Buildings are NON-RECTANGULAR** - parallelograms, trapezoids via independent corner depths
2. **Buildings should fill ALL sides of a block**, not just one side
3. **Buildings are wall-to-wall** - no gaps between adjacent buildings, they share walls
4. **Building depth VARIES per corner** - depthLeft and depthRight are DIFFERENT values
5. **4 corners only** - buildings are always quadrilaterals
6. **Buildings must stay inside their block**

## Block Rules - DO NOT FORGET

1. **Blocks NEVER cross roads** - always inside enclosed road areas
2. **Blocks should be as close to roads as possible** - minimal gap
3. **Only enclosed blocks** - must be fully surrounded by roads (no buffer zones for dead-ends)
4. **No overlapping blocks** - each block is unique

## Color Scheme
- Roads: Blue (#4a6fa5)
- Blocks: Near-white (rgba(245, 245, 250, 0.25))
- Buildings: Pantone turquoise (#40c4aa)

## Block Detection
- Only enclosed blocks (fully surrounded by roads)
- No buffer zones for dead-ends (disabled for now)
- Blocks are simplified with Douglas-Peucker algorithm for straighter edges
