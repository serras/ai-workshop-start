---
name: issue-to-pr
description: Turn a GitHub issue into a pull request
---

Given the issue, create a pull request implementing it. In general, be succinct.

Follow these instructions during the implementation:
- Update or add the specifications in the `spec` folder with anything relevant.
- Create a plan with multiple meaningful steps, and turn each step into a separate commits.

As part of the pull request:
- Include a high-level description of the design decisions, especially if anything in the issue was not entirely clear.
- Include the plan that was followed for the implementation.

If the issue includes new UI workflows:
- If it is complex, create a small Mermaid diagram describing the possible states and transitions.
- Create a recording showing the main workflows.

If the issue touches smaller UI elements:
- Create one or more images showing the UI changes (some sort of "diff").