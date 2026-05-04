import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface SseEvent {
	event: string;
	data: string;
	id: string;
	retry?: number;
}

export class SseClient implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SSE Client',
		name: 'sseClient',
		icon: 'file:sse-client.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["url"]}}',
		description:
			'Connect to an SSE endpoint, collect events, return on stop condition',
		defaults: { name: 'SSE Client' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'httpBearerAuth',
				required: false,
				displayOptions: {
					show: { authentication: ['bearerAuth'] },
				},
			},
			{
				name: 'httpHeaderAuth',
				required: false,
				displayOptions: {
					show: { authentication: ['headerAuth'] },
				},
			},
			{
				name: 'anthropicApi',
				required: false,
				displayOptions: {
					show: { authentication: ['anthropicApi'] },
				},
			},
		],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/sse',
				description: 'URL of the SSE endpoint. Supports n8n expressions.',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'None', value: 'none' },
					{ name: 'Anthropic API Key', value: 'anthropicApi' },
					{ name: 'Bearer Auth', value: 'bearerAuth' },
					{ name: 'Header Auth (API Key)', value: 'headerAuth' },
				],
				default: 'none',
				description:
					'How to authenticate with the SSE endpoint. Use Header Auth for API key authentication (e.g., x-api-key).',
			},
			{
				displayName: 'Send Custom Headers',
				name: 'sendHeaders',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Specify Headers',
				name: 'specifyHeaders',
				type: 'options',
				options: [
					{ name: 'Using Fields Below', value: 'keypair' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'keypair',
				displayOptions: {
					show: { sendHeaders: [true] },
				},
			},
			{
				displayName: 'Header Parameters',
				name: 'headerParameters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add Header',
				displayOptions: {
					show: { sendHeaders: [true], specifyHeaders: ['keypair'] },
				},
				options: [
					{
						name: 'parameters',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Headers (JSON)',
				name: 'headersJson',
				type: 'json',
				default: '{}',
				displayOptions: {
					show: { sendHeaders: [true], specifyHeaders: ['json'] },
				},
			},
			{
				displayName: 'Stop Event Type',
				name: 'stopEventType',
				type: 'string',
				default: '',
				placeholder: 'e.g. session\\.status_(idle|terminated)',
				description:
					'Regex pattern on the SSE event type field. When matched, the node stops collecting.',
			},
			{
				displayName: 'Stop Data Pattern',
				name: 'stopDataPattern',
				type: 'string',
				default: '',
				placeholder: 'e.g. "status":"completed"',
				description:
					'Regex pattern on the SSE data field. When matched, the node stops collecting.',
			},
			{
				displayName: 'Include Stop Event',
				name: 'includeStopEvent',
				type: 'boolean',
				default: true,
				description:
					'Whether to include the event that triggered the stop condition in the output',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Timeout (ms)',
						name: 'timeout',
						type: 'number',
						default: 300000,
						description: 'Global timeout in milliseconds (default: 5 minutes)',
					},
					{
						displayName: 'Retry Attempts',
						name: 'retryAttempts',
						type: 'number',
						default: 3,
						typeOptions: { minValue: 0 },
					},
					{
						displayName: 'Retry Delay (ms)',
						name: 'retryDelay',
						type: 'number',
						default: 1000,
						typeOptions: { minValue: 0 },
					},
					{
						displayName: 'Include Metadata',
						name: 'includeMetadata',
						type: 'boolean',
						default: true,
						description:
							'Whether to add $metadata (eventType, lastEventId, timestamp, origin) to each event',
					},
					{
						displayName: 'Max Events',
						name: 'maxEvents',
						type: 'number',
						default: 0,
						description: 'Max events to collect (0 = unlimited)',
						typeOptions: { minValue: 0 },
					},
					{
						displayName: 'Filter Event Types',
						name: 'filterEventTypes',
						type: 'string',
						default: '',
						placeholder: 'e.g. message|update|notification',
						description:
							'Regex pattern — only collect events whose type matches. Empty = collect all. Stop conditions are still evaluated on all events.',
					},
					{
						displayName: 'HTTP Method',
						name: 'httpMethod',
						type: 'options',
						options: [
							{ name: 'GET', value: 'GET' },
							{ name: 'POST', value: 'POST' },
						],
						default: 'GET',
					},
					{
						displayName: 'Request Body',
						name: 'requestBody',
						type: 'json',
						default: '',
						displayOptions: {
							show: { httpMethod: ['POST'] },
						},
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const allOutputItems: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const collectedEvents = await processItem.call(this, itemIndex);

				for (const item of collectedEvents) {
					allOutputItems.push({ json: item });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					allOutputItems.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
				} else {
					throw error;
				}
			}
		}

		return [allOutputItems];
	}
}

async function processItem(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const url = this.getNodeParameter('url', itemIndex) as string;
	const authentication = this.getNodeParameter('authentication', itemIndex) as string;
	const sendHeaders = this.getNodeParameter('sendHeaders', itemIndex) as boolean;
	const stopEventType = this.getNodeParameter('stopEventType', itemIndex) as string;
	const stopDataPattern = this.getNodeParameter('stopDataPattern', itemIndex) as string;
	const includeStopEvent = this.getNodeParameter('includeStopEvent', itemIndex) as boolean;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const timeout = (options.timeout as number) ?? 300000;
	const retryAttempts = (options.retryAttempts as number) ?? 3;
	const retryDelay = (options.retryDelay as number) ?? 1000;
	const includeMetadata = (options.includeMetadata as boolean) ?? true;
	const maxEvents = (options.maxEvents as number) ?? 0;
	const filterEventTypes = (options.filterEventTypes as string) ?? '';
	const httpMethod = (options.httpMethod as string) ?? 'GET';
	const requestBody = (options.requestBody as string) ?? '';

	const headers: Record<string, string> = {
		Accept: 'text/event-stream',
		'Cache-Control': 'no-cache',
	};

	if (authentication === 'anthropicApi') {
		const credentials = await this.getCredentials('anthropicApi');
		headers['x-api-key'] = credentials.apiKey as string;
	} else if (authentication === 'bearerAuth') {
		const credentials = await this.getCredentials('httpBearerAuth');
		headers['Authorization'] = `Bearer ${credentials.token as string}`;
	} else if (authentication === 'headerAuth') {
		const credentials = await this.getCredentials('httpHeaderAuth');
		headers[credentials.name as string] = credentials.value as string;
	}

	if (sendHeaders) {
		const specifyHeaders = this.getNodeParameter('specifyHeaders', itemIndex) as string;
		if (specifyHeaders === 'keypair') {
			const headerParams = this.getNodeParameter(
				'headerParameters.parameters',
				itemIndex,
				[],
			) as Array<{ name: string; value: string }>;
			for (const param of headerParams) {
				if (param.name) {
					headers[param.name] = param.value;
				}
			}
		} else {
			const headersJson = this.getNodeParameter('headersJson', itemIndex, '{}') as string;
			const parsed = JSON.parse(headersJson) as Record<string, string>;
			Object.assign(headers, parsed);
		}
	}

	const stopEventRegex = stopEventType ? new RegExp(stopEventType) : null;
	const stopDataRegex = stopDataPattern ? new RegExp(stopDataPattern) : null;
	const filterRegex = filterEventTypes ? new RegExp(filterEventTypes) : null;

	const collectedEvents: IDataObject[] = [];

	for (let attempt = 0; attempt <= retryAttempts; attempt++) {
		const controller = new AbortController();

		const timeoutId = setTimeout(() => controller.abort(), timeout);

		let cancelSignal: AbortSignal | undefined;
		try {
			cancelSignal = this.getExecutionCancelSignal?.();
		} catch {
			// older n8n versions may not have this
		}
		if (cancelSignal) {
			cancelSignal.addEventListener('abort', () => controller.abort(), { once: true });
		}

		try {
			const fetchOptions: RequestInit = {
				method: httpMethod,
				headers,
				signal: controller.signal,
			};
			if (httpMethod === 'POST' && requestBody) {
				fetchOptions.body = requestBody;
				if (!headers['Content-Type']) {
					headers['Content-Type'] = 'application/json';
				}
			}

			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				throw new NodeOperationError(
					this.getNode(),
					`HTTP ${response.status}: ${response.statusText}`,
					{ itemIndex },
				);
			}

			if (!response.body) {
				throw new NodeOperationError(
					this.getNode(),
					'Response body is empty — no stream available',
					{ itemIndex },
				);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let currentEvent: Partial<SseEvent> = {};
			let stopReached = false;

			try {
				while (!stopReached) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop()!;

					for (const line of lines) {
						if (stopReached) break;

						if (line === '') {
							if (currentEvent.data !== undefined) {
								const eventType = currentEvent.event || 'message';
								const eventData = currentEvent.data;

								const matchesStop =
									(stopEventRegex && stopEventRegex.test(eventType)) ||
									(stopDataRegex && stopDataRegex.test(eventData));

								const passesFilter =
									!filterRegex || filterRegex.test(eventType);

								if (matchesStop) {
									stopReached = true;
									if (includeStopEvent && passesFilter) {
										collectedEvents.push(
											buildOutputItem(
												eventType,
												eventData,
												currentEvent.id || '',
												url,
												includeMetadata,
											),
										);
									}
								} else if (passesFilter) {
									collectedEvents.push(
										buildOutputItem(
											eventType,
											eventData,
											currentEvent.id || '',
											url,
											includeMetadata,
										),
									);
								}

								if (
									maxEvents > 0 &&
									collectedEvents.length >= maxEvents
								) {
									stopReached = true;
								}
							}
							currentEvent = {};
						} else if (line.startsWith('data:')) {
							const val = line.slice(5).trimStart();
							currentEvent.data =
								currentEvent.data !== undefined
									? currentEvent.data + '\n' + val
									: val;
						} else if (line.startsWith('event:')) {
							currentEvent.event = line.slice(6).trimStart();
						} else if (line.startsWith('id:')) {
							currentEvent.id = line.slice(3).trimStart();
						} else if (line.startsWith('retry:')) {
							const retryVal = parseInt(line.slice(6).trimStart(), 10);
							if (!isNaN(retryVal)) {
								currentEvent.retry = retryVal;
							}
						}
						// lines starting with ':' are comments/heartbeats — ignored
					}
				}
			} finally {
				reader.releaseLock();
			}

			clearTimeout(timeoutId);
			return collectedEvents;
		} catch (error) {
			clearTimeout(timeoutId);

			const isAbort =
				error instanceof DOMException && error.name === 'AbortError';

			if (isAbort) {
				if (collectedEvents.length > 0) {
					return collectedEvents;
				}
				throw new NodeOperationError(
					this.getNode(),
					'Timeout reached with no events collected',
					{ itemIndex },
				);
			}

			const isClientError = error instanceof NodeOperationError &&
				/^HTTP 4\d{2}:/.test(error.message);

			if (!isClientError && attempt < retryAttempts) {
				await new Promise((r) => setTimeout(r, retryDelay));
				continue;
			}

			if (collectedEvents.length > 0) {
				return collectedEvents;
			}

			if (error instanceof NodeOperationError) {
				throw error;
			}
			throw new NodeOperationError(
				this.getNode(),
				`SSE connection failed: ${(error as Error).message}`,
				{ itemIndex },
			);
		}
	}

	return collectedEvents;
}

function buildOutputItem(
	eventType: string,
	rawData: string,
	lastEventId: string,
	origin: string,
	includeMetadata: boolean,
): IDataObject {
	let parsed: IDataObject;
	try {
		parsed = JSON.parse(rawData) as IDataObject;
	} catch {
		parsed = { data: rawData };
	}

	if (includeMetadata) {
		parsed.$metadata = {
			eventType,
			lastEventId,
			timestamp: new Date().toISOString(),
			origin,
		};
	}

	return parsed;
}
