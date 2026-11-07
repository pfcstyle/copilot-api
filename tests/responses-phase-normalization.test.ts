import { describe, expect, test } from "bun:test"

import type {
  ResponseOutputItem,
  ResponsesResult,
  ResponseStreamEvent,
} from "~/lib/types/responses"
import {
  normalizeResponseMessagePhases,
  normalizeResponsePhaseEvents,
} from "~/routes/responses/phase-normalization"

const message = (
  id: string,
  phase?: "commentary" | "final_answer",
): ResponseOutputItem => ({
  content: [{ annotations: [], text: id, type: "output_text" }],
  id,
  phase,
  role: "assistant",
  status: "completed",
  type: "message",
})

const response = (
  output: Array<ResponseOutputItem>,
  status = "completed",
): ResponsesResult => ({
  created_at: 1,
  error: null,
  id: "resp-phase",
  incomplete_details: null,
  instructions: null,
  metadata: null,
  model: "glm-5.3",
  object: "response",
  output,
  output_text: "",
  parallel_tool_calls: true,
  status,
  temperature: null,
  tool_choice: "auto",
  tools: [],
  top_p: null,
  usage: null,
})

const collect = async (
  sourceEvents: Array<ResponseStreamEvent>,
): Promise<Array<ResponseStreamEvent>> => {
  const source = (async function* () {
    await Promise.resolve()
    yield* sourceEvents
  })()
  const result: Array<ResponseStreamEvent> = []
  for await (const event of normalizeResponsePhaseEvents(source)) {
    result.push(event)
  }
  return result
}

const getMessagePhase = (event: ResponseStreamEvent): string | undefined => {
  if (
    (event.type === "response.output_item.added"
      || event.type === "response.output_item.done")
    && event.item.type === "message"
  ) {
    return event.item.phase
  }
  return undefined
}

describe("Codex Responses phase normalization", () => {
  test("marks completed text as final_answer", () => {
    const normalized = normalizeResponseMessagePhases(response([message("m1")]))
    expect(normalized.output[0]).toMatchObject({ phase: "final_answer" })
  })

  test("marks text as commentary when the response calls client tools", () => {
    const normalized = normalizeResponseMessagePhases(
      response([
        message("m1"),
        {
          arguments: "{}",
          call_id: "call-1",
          id: "fc-1",
          name: "read_file",
          namespace: "workspace",
          type: "function_call",
        },
        {
          call_id: "call-2",
          id: "ctc-1",
          input: "*** Begin Patch",
          name: "apply_patch",
          type: "custom_tool_call",
        },
      ]),
    )
    expect(normalized.output[0]).toMatchObject({ phase: "commentary" })
  })

  test("marks incomplete text as commentary and preserves provider phases", () => {
    const normalized = normalizeResponseMessagePhases(
      response([message("m1"), message("m2", "final_answer")], "incomplete"),
    )
    expect(normalized.output[0]).toMatchObject({ phase: "commentary" })
    expect(normalized.output[1]).toMatchObject({ phase: "final_answer" })
  })

  test("buffers an undecided stream message until a later tool call", async () => {
    const events = await collect([
      {
        item: message("m1"),
        output_index: 0,
        sequence_number: 4,
        type: "response.output_item.added",
      },
      {
        content_index: 0,
        delta: "Checking",
        item_id: "m1",
        output_index: 0,
        sequence_number: 5,
        type: "response.output_text.delta",
      },
      {
        item: {
          arguments: "{}",
          call_id: "call-1",
          id: "fc-1",
          name: "inspect",
          type: "function_call",
        },
        output_index: 1,
        sequence_number: 6,
        type: "response.output_item.added",
      },
      {
        response: response([
          message("m1"),
          {
            arguments: "{}",
            call_id: "call-1",
            id: "fc-1",
            name: "inspect",
            type: "function_call",
          },
        ]),
        sequence_number: 7,
        type: "response.completed",
      },
    ])

    expect(events.map((event) => event.sequence_number)).toEqual([4, 5, 6, 7])
    expect(getMessagePhase(events[0])).toBe("commentary")
    const completed = events[3]
    expect(completed?.type).toBe("response.completed")
    if (completed?.type === "response.completed") {
      expect(completed.response.output[0]).toMatchObject({
        phase: "commentary",
      })
    }
  })

  test("releases a no-tool stream as final_answer at completion", async () => {
    const events = await collect([
      {
        item: message("m1"),
        output_index: 0,
        sequence_number: 1,
        type: "response.output_item.added",
      },
      {
        response: response([message("m1")]),
        sequence_number: 2,
        type: "response.completed",
      },
    ])

    expect(getMessagePhase(events[0])).toBe("final_answer")
    expect(events[1]).toMatchObject({
      response: { output: [{ phase: "final_answer" }] },
    })
  })

  test("uses commentary for failed streams", async () => {
    const failedResponse = response([message("m1")], "failed")
    const events = await collect([
      {
        item: message("m1"),
        output_index: 0,
        sequence_number: 1,
        type: "response.output_item.added",
      },
      {
        response: failedResponse,
        sequence_number: 2,
        type: "response.failed",
      },
    ])

    expect(getMessagePhase(events[0])).toBe("commentary")
    expect(events[1]).toMatchObject({
      response: { output: [{ phase: "commentary" }] },
    })
  })
})
