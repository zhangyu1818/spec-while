# Tasks

## Phase 1: Core

- [ ] T001 Implement buildGreeting in src/greeting.ts
  - Paths: src/greeting.ts
  - Depends:
  - Acceptance:
    - buildGreeting('Ada') returns Hello, Ada!
  - Verify:
    - node --import tsx --test test/greeting.test.ts
  - Review Rubric:
    - implementation is simple and scoped
  - Max Iterations: 2

- [ ] T002 Implement buildFarewell in src/farewell.ts
  - Paths: src/farewell.ts
  - Depends: T001
  - Acceptance:
    - buildFarewell('Ada') returns Bye, Ada!
  - Verify:
    - node --import tsx --test test/greeting.test.ts test/farewell.test.ts
  - Review Rubric:
    - implementation is simple and scoped
  - Max Iterations: 2
