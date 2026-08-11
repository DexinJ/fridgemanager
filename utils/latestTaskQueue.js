export function createLatestTaskQueue() {
  let tail = Promise.resolve();
  let generation = 0;

  const append = (task) => {
    const result = tail.catch(() => {}).then(task);
    tail = result;
    return result;
  };

  return {
    runLatest(task, { supersededValue } = {}) {
      const taskGeneration = ++generation;
      return append(() =>
        taskGeneration === generation ? task() : supersededValue
      );
    },
    invalidateAndRun(task) {
      generation += 1;
      return append(task);
    },
  };
}
