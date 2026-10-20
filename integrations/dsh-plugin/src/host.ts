import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, feedbackForModel, systemPrompt } from '@tessera/lang';
import { startCollector, type Collector, type CollectorOptions } from './collector';
import { MAX_BINDINGS, OUTPUTS_KEY, outputsProjection, resolveData, type OutputsState, type ToolOutput } from './data';
import { catalog, META_KEY, TOOL_NAME } from './shared';
import { TELEMETRY_KEY } from './telemetry';

// Host half of dsh-plugin-tessera: the render_ui tool. The browser half draws the call itself, live from the
// streamed arguments; this side compiles the same source so the model hears about anything that was dropped, and
// resolves the tool data the call names. Nothing from the harness is imported at runtime, so the plugin does not
// drift with harness releases.

export const name = 'tessera';
export const inject = ['tools'];

const INTRO = `Show the user an interactive interface in this chat. Pass it as Tessera markup in \`source\`.
Use it when a visual or interactive answer is clearly better than text: comparing options, calculators and estimates,
checklists, choices to click, progress, the status of a pull request. Otherwise just reply in Markdown.
The interface appears in the conversation where you call this tool and stays there, so keep talking to the user in
your normal reply instead of repeating it. Each call shows a new interface. When the user clicks something that calls
ui.send("…"), that text arrives as their next message. Values must come from what you know (tool output, files, the
user); never invent data to fill an interface.`;

const TOOL_DATA = `Tool data
- To show values from an earlier tool result (a file you read, a command's output), bind that result to a name in
  the \`data\` argument instead of copying its values into the source:
  data: [{ "name": "pkg", "tool": "read", "match": "package.json" }]
  \`tool\` is the tool you called. \`match\` is optional text from that call's arguments (a path, part of the command)
  and picks the latest call containing it; without it the latest call of that tool is used. Call ${TOOL_NAME} after
  that call has returned.
- A bound name holds what the call returned: for read, the file's text; for a shell command, its output. Text that
  is a JSON object or array is parsed, so {pkg.version} works; any other text is a string: use string methods, e.g.
  {@let lines = log.trim().split("\\n")} then {lines.length} or {#each lines as line} … {/each}.
  A field that may be missing takes a fallback: {pkg.version ?? "未声明"}.
- Never retype a value from a tool result, in components or in sentences: write "当前版本 {pkg.version}", not the
  version itself. Derive what you need with @let (splitting, sorting, filtering, picking the best).
- The result of ${TOOL_NAME} lists each bound name with its fields, and any field you used that does not exist.`;

export const description = systemPrompt(catalog, { intro: INTRO, toolData: false, extra: TOOL_DATA });

export interface RenderResult {
  readonly shown: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly text: string;
  /** The resolved tool data. Kept out of `text`: it reaches the browser through the result's metadata only. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * What the model hears back: shown, the names it bound and their shapes, and what was left out if anything.
 * `outputs` are the session's recent tool outputs; undefined when the host cannot provide them.
 */
export function renderUi(source: string, bindings?: unknown, outputs?: readonly ToolOutput[]): RenderResult {
  if (!source.trim()) return { shown: false, errors: 0, warnings: 0, text: 'Nothing was shown: source was empty.' };
  const wanted = Array.isArray(bindings) ? bindings.length > 0 : bindings !== undefined && bindings !== null;
  const resolved =
    wanted && outputs === undefined
      ? { data: {}, bound: [], problems: ['tool data is not available in this session, so no names were bound'] }
      : resolveData(bindings, outputs ?? []);
  const { diagnostics } = compile(source, { catalog, data: resolved.data });
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  // feedbackForModel words its header for the next turn ("your previous interface"); here only its lines fit.
  const problems = (feedbackForModel(diagnostics) ?? '').split('\n').filter((line) => line.startsWith('- '));
  const parts = [
    problems.length
      ? `The interface is shown to the user, but ${errors ? 'these parts were left out' : 'with these warnings'}. ` +
        `If they matter, call ${TOOL_NAME} again with a corrected version:\n${problems.join('\n')}`
      : 'The interface is shown to the user.',
  ];
  if (resolved.bound.length) parts.push(`Bound tool data (shown from the results, not from your text):\n${resolved.bound.map((l) => `- ${l}`).join('\n')}`);
  if (resolved.problems.length) parts.push(`These data names were not bound:\n${resolved.problems.map((l) => `- ${l}`).join('\n')}`);
  const hasData = Object.keys(resolved.data).length > 0;
  return { shown: true, errors, warnings, text: parts.join('\n'), ...(hasData ? { data: resolved.data } : {}) };
}

interface ToolsService {
  register(definition: unknown): () => void;
}

interface ProjectionsService {
  register(definition: unknown): () => void;
  stateOf(session: unknown, key: string): unknown;
}

interface HostContext {
  tools: ToolsService;
  effect?(setup: () => () => void): void;
  inject?(deps: string[], callback: (ctx: HostContext & { sessionProjections: ProjectionsService }) => void): void;
}

interface ToolExecution {
  readonly agent?: { readonly session?: unknown };
}

/** The plugin's config (the `config:` block of its entry in cordis.patch.yml). */
export interface Config {
  /**
   * The local stats collector: on by default at http://127.0.0.1:4317, with events in `.telemetry/` beside lib/.
   * `false` turns it off; then the browser half reports nothing.
   */
  readonly telemetry?: boolean | { readonly port?: number; readonly dir?: string };
}

export const DEFAULT_TELEMETRY_PORT = 4317;

/** Where the collector listens and writes, or null when telemetry is off. */
export function telemetryOptions(config: Config | undefined): CollectorOptions | null {
  const t = config?.telemetry ?? true;
  if (t === false) return null;
  const options = typeof t === 'object' ? t : {};
  // Beside lib/ once built (lib/index.js), beside src/ in tests: the plugin folder either way.
  const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  return { port: options.port ?? DEFAULT_TELEMETRY_PORT, dir: options.dir ?? join(pluginDir, '.telemetry') };
}

export function apply(ctx: HostContext, config?: Config): void {
  // The collector needs a lifecycle to close its port, so it starts only under the harness's effect().
  let collector: Collector | undefined;
  const telemetry = telemetryOptions(config);
  if (telemetry && ctx.effect) {
    ctx.effect(() => {
      let disposed = false;
      startCollector(telemetry).then(
        (started) => {
          if (disposed) return void started.close();
          collector = started;
          console.info(`[tessera] stats: ${started.url} (events in ${started.file})`);
        },
        (error: Error) => console.warn(`[tessera] telemetry is off: ${error.message}`),
      );
      return () => {
        disposed = true;
        void collector?.close();
        collector = undefined;
      };
    });
  }

  // Recent tool outputs per session, folded from the log. Optional: without the registry nothing can be bound.
  let projections: ProjectionsService | undefined;
  ctx.inject?.(['sessionProjections'], (child) => {
    child.sessionProjections.register(outputsProjection);
    projections = child.sessionProjections;
    child.effect?.(() => () => {
      projections = undefined;
    });
  });

  const outputsOf = (exec: ToolExecution | undefined): readonly ToolOutput[] | undefined => {
    const session = exec?.agent?.session;
    if (!session || !projections) return undefined;
    return (projections.stateOf(session, OUTPUTS_KEY) as OutputsState | undefined)?.outputs;
  };

  ctx.tools.register({
    name: TOOL_NAME,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'The interface, written in Tessera markup.' },
        data: {
          type: 'array',
          description: `Earlier tool results to show by name, at most ${MAX_BINDINGS}. Optional.`,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'The name the source uses, e.g. pkg for {pkg.version}.' },
              tool: { type: 'string', description: 'The tool that produced the result, e.g. read or bash.' },
              match: {
                type: 'string',
                description: "Text from that call's arguments, such as a path or part of the command; the latest call containing it is used.",
              },
            },
            required: ['name', 'tool'],
          },
        },
      },
      required: ['source'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shown: { type: 'boolean' },
          errors: { type: 'integer' },
          warnings: { type: 'integer' },
          text: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['shown', 'errors', 'warnings', 'text'],
      },
      render: (_args: unknown, value: RenderResult) => [{ type: 'text', text: value.text }],
      // Stored with the result in the session log and never sent to the model: the browser reads the data here,
      // and the collector's URL while it runs.
      presentationMeta: (_args: unknown, value: RenderResult) => ({
        ...(value.data ? { [META_KEY]: value.data } : {}),
        ...(collector ? { [TELEMETRY_KEY]: collector.url } : {}),
      }),
    },
    async execute(args: { source?: unknown; data?: unknown }, exec?: ToolExecution): Promise<RenderResult> {
      return renderUi(typeof args.source === 'string' ? args.source : '', args.data, outputsOf(exec));
    },
  });
}
