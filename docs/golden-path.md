# The golden path

Two commands. That is the whole public workflow: `detent init` plans the work,
and `detent run` carries out the plan you approved.

In Claude Code they are `/detent:init` and `/detent:run`. The same referee also
runs headless, as a deterministic loop, for CI and unattended runs.

```bash
detent init
```

`init` runs eleven phases, in order. On a terminal it asks you DECIDE's questions as it goes; otherwise it stops only where it can't go on without you, and at the end for your approval. Each phase in a sentence:

- **INIT_FS**: checks you're at the root of a git repository and creates the `.detent/` folder.
- **DISCOVER**: finds your planning documents, and the commands that test, lint and build your project.
- **AUDIT**: reads your documents and lists what contradicts itself and what's missing. It checks the claims your decisions rely on, such as how a library behaves at the version you pin, against their sources.
- **DECIDE**: settles what AUDIT left open. It asks you what only you can decide, such as money or contracts, proposes a default for the rest, and records everything in `docs/founder-decisions.md`.
- **WRITE**: rewrites your documents into the *pack*, a standard layout in which every requirement has an id and testable acceptance criteria. Your originals move to `archive/`; nothing is deleted.
- **VALIDATE**: has reviewers check the pack and a writer fix what they find, round after round, until no serious problem is left or 8 rounds have run (the default). A problem it can't fix stops `init` for you.
- **DETERMINE_VERIFICATION**: runs the candidate commands and keeps the ones that work as the *gates* every change must pass.
- **SLICE**: cuts the product into *slices*, small increments that each run, starting with the smallest version that works end to end.
- **PLAN**: turns each slice into *tickets*, small tasks that each name their acceptance criteria, the files they may change and what they wait on. Code checks every ticket, and a reviewer reads each slice's plan.
- **PREPARE_AGENTS**: chooses the role, and the model, for each ticket's sessions.
- **PRESENT**: shows you the plan, the decisions and defaults, the risks left open and what planning cost, then waits for your approval.

[how-it-works.md](how-it-works.md) has each phase in full, with the cost estimates `init` prints and the settings below.

Two settings change how `init` runs, in `.detent/config.json`. `init_sessions_at_once`, under `budgets`, is how many of AUDIT's checks and VALIDATE's reviews run at once (4 by default, 1 to 16). `review_foundations` set to `given` makes each review about 40% cheaper, but it finds less. The default stays `read`: on Detent's review set, reviewers handed the foundations found every blocker but only 113 of its 132 majors, where reviewers reading them found 124.

```bash
detent run
```

```mermaid
flowchart TD
    I["detent init"] --> A{"your approval"}
    A --> R["detent run"]
    R --> C["claim next ticket"]
    C --> S["fresh session<br>contained to the ticket's surface"]
    S --> G{"your own gates<br>test · lint · build"}
    G -- green --> V{"independent review"}
    G -- red --> L["fix ladder<br>blind → research → informed"]
    L --> G
    L -- exhausted --> H["you<br>dossier in hand, requeue at will"]
    H --> C
    V -- changes --> S
    V -- approve --> D["DONE<br>finalized on the run branch"]
    D --> C

    classDef you fill:#fbbf24,stroke:#b45309,color:#1f2937
    classDef machine fill:#6366f1,stroke:#4338ca,color:#ffffff
    classDef verify fill:#34d399,stroke:#047857,color:#1f2937
    classDef ladder fill:#f87171,stroke:#b91c1c,color:#1f2937
    class A,H you
    class I,R,C,S,D machine
    class G,V verify
    class L ladder
```

`run` takes the next ticket and starts a fresh Claude Code session that may
change only the files the ticket names. Then it runs your project's own
tests, lint and build. When they pass, a separate session reviews the change.
When they fail, Detent tries to fix it, first directly, then after researching
the failure, and hands the ticket to you if nothing works.

Amber is you; indigo is Detent; green is checking; red is fixing. The
*referee*, plain code and not a model, decides every move, and records each one
in `transitions.jsonl`. A limit you set, on attempts or on spending, hands
the ticket to you and is never retried, and a ticket labelled risky waits for your approval before it's
done.

