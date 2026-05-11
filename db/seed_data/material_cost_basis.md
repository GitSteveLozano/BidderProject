# Material cost basis — simulated PoC

Per-unit costs for the `lookup_material_cost` tool. Calibrated to 2026
Hawaii contractor norms. Real ProService deployment swaps these for live
catalog API data per spec §12.6.

| Service line              | Unit     | Cost/unit | Waste factor |
| ------------------------- | -------- | --------: | -----------: |
| STUCCO-CONVENTIONAL       | sqft     | $7.20     | 10%          |
| STUCCO-textured acrylic   | sqft     | $8.40     | 10%          |
| EIFS                      | sqft     | $11.50    |  8%          |
| Siding                    | sqft     | $9.80     | 12%          |
| METAL WORK                | lf       | $14.00    |  8%          |
| RESTUCCO                  | sqft     | $5.40     | 10%          |
| REPAIR                    | lump_sum | $1.00     |  0%          |
| DEMOLITION                | sqft     | $2.80     |  0%          |

## Sources

- BMI Products Hawaii dealer list (2025 base): stucco mix + lath averages
- ADEX system component list (residential EIFS spec)
- James Hardie + Gentek 2025 distributor prices (Hawaii uplift)
- Hawaii contractor margin discussions per discovery (Cavy, Dale)

## Waste factors

10% standard for cementitious finishes; 12% for siding lap-cuts; 8% for
panel goods (EIFS boards, metal panels) where cut planning is more
efficient.
