---
name: issue-to-pr
description: Turn a GitHub issue into a pull request
---

Given the issue, figure out all possible design decisions, and create a pull request implementing it.

If the description of the issue is not clear enough, or requires some additional design decisions, discuss this in Slack before proceeding. 
- Send a message to the Slack `aiworkshopatjetbrains` workspace, in the private channel `serras-air` (channel id C0CB10YQK4L), as the "AIR" application using the given `SLACK_BOT_TOKEN` environment variable.
- For each potential question, ask a different message. The conversation should continue in the thread, until a satisfactory answer is found.
- Once all the decisions are clear, post a message in Slack summarizing all the decisions, and stating that implementation of the issue is about to begin.

Once all the decisions are clear, create a pull request implementing the issue. In general, be succinct.

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