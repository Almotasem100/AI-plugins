import { Rpc } from '@opencode/plugin/rpc'

const windowSchema = {
  type: 'object',
  properties: { percent: { type: 'number', minimum: 0, maximum: 100 }, resetsAt: { type: ['string', 'null'] } },
  required: ['percent', 'resetsAt'], additionalProperties: false,
}
const providerSchema = {
  type: 'object',
  properties: {
    status: { enum: ['ok', 'not-signed-in', 'token-expired', 'unavailable', 'unexpected-format'] },
    fiveHour: windowSchema, weekly: windowSchema,
  },
  required: ['status'], additionalProperties: false,
}
export const Usage = Rpc.define({
  id: 'subscription-usage',
  events: {},
  methods: { refresh: { input: { type: 'null' }, output: {
    type: 'object', properties: { claude: providerSchema, chatgpt: providerSchema },
    required: ['claude', 'chatgpt'], additionalProperties: false,
  } } },
})
