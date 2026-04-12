export function pLimit(concurrency) {
  let active = 0;
  const queue = [];

  function next() {
    if (active < concurrency && queue.length) {
      active++;
      queue.shift()();
    }
  }

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          })
      );
      next();
    });
}
