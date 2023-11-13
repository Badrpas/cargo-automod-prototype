class Queue {
  q = [];

  push(job) {
    const deferred = {};
    const promise = new Promise((resolve, reject) => Object.assign(deferred, { resolve, reject }));
    const wrapped_job = async () => {
      try {
        deferred.resolve(await job());
      } catch (err) {
        deferred.reject(err);
      }
    };
    this.q.push(wrapped_job);
    if (this.q.indexOf(wrapped_job) == 0) {
      Promise.resolve().then(this.#run);
    }
    return promise;
  }

  #run = async () => {
    const [job] = this.q;
    await job();
    this.q.shift();
    if (this.q.length) {
      await this.#run();
    } else {
      console.log('Queue free');
    }
  }
}

module.exports.Queue = Queue;
