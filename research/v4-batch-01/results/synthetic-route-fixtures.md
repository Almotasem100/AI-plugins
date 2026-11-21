# Synthetic route fixtures

Fixtures are in `research/v4-batch-01/fixtures/route-cases.json`; deterministic checks are in `research/v4-batch-01/fixtures/route-cases.test.mjs`.

| Case | Input requirement | Route result | Evidence/status |
|---|---|---|---|
| Image input | PNG/JPEG/WebP/GIF attachment | OpenCode Gemini provider is a documented candidate; ZadLoop provider is also documented as image-capable. | Provider docs and fake-ACP tests; live host/CLI image handling not exercised in this batch. |
| Host-controlled tools | Host approval and real host tool results | Reject Gemini YOLO-native loop as a host-controlled route; neither bridge is implemented. | Documented and source-backed boundary; no tool bridge launched. |
| Independent read-only review | Independent reviewer plus enforced read-only | **Blocked/unverified** for Gemini CLI provider/native routes: host approvals do not govern YOLO tools, and no OS containment was verified. | No permission experiment or private source was accessed. |
| Ordinary text summary | Text only | A configured low-cost specialist is a candidate only. Deterministic scripts are preferable for exact extraction/counting; no model dispatch was made for this case. | Route-selection fixture only, not a demonstrated summary result. |

## Reproduction

From the repository root:

```powershell
node --test research/v4-batch-01/fixtures/route-cases.test.mjs
```

This test reads immutable synthetic route records and does not modify files, launch a host/CLI, or contact a model. No reset/cleanup is needed. For the separate benchmark reset test, see the [ai-harness-benchmarks fixture guide](https://github.com/Almotasem100/ai-harness-benchmarks/blob/research/v4-composability-batch-01/research/v4-batch-01/fixtures/README.md).

## Scope and acceptance

The deterministic assertions reject labeling YOLO-native actions “host-approved,” reject a read-only classification without enforced containment evidence, and keep capability records distinct from model/token/cost observations. The source fixture includes negative controls. Passing does not prove live routing, image support in a given host version, tool isolation, or review quality.
