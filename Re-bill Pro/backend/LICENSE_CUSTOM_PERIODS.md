# Custom License Periods

Platform Admin license creation now supports:

- 1 Day Trial
- 3 Day Trial
- 1 Month
- 3 Months
- 6 Months
- 12 Months
- Lifetime
- Custom Days (1-3650 days)

Trial/custom licenses automatically expire at the end of their selected period using the existing license-expiration enforcement.


## License period display order

The Create License selector is ordered shortest to longest:

1. 1 Day Trial
2. 3 Day Trial
3. 1 Month
4. 3 Months
5. 6 Months
6. 12 Months
7. Lifetime
8. Custom Days

The 1-month and 6-month plans are handled by the backend with calendar-month expiration logic.
