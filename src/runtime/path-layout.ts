import path from 'node:path'

export function createRuntimePaths(featureDir: string) {
  const runtimeDir = path.join(featureDir, '.while')
  return {
    events: path.join(runtimeDir, 'events.jsonl'),
    graph: path.join(runtimeDir, 'graph.json'),
    report: path.join(runtimeDir, 'report.json'),
    runtimeDir,
    state: path.join(runtimeDir, 'state.json'),
    tasksDir: path.join(runtimeDir, 'tasks'),
  }
}
