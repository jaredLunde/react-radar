import {objectWithoutProps} from '../utils'


const jsonExclusions = {commit: 0, listeners: 0, query: 0}
const urlExclusion = {url: 0}

export default (
  initialQueries = (
    typeof document !== 'undefined'
      && document.getElementById('radar-cache')
  )
) => {
  const map = new Map()

  const cache = {
    get: map.get.bind(map),
    set (id, v) {
      let q = map.get(id)

      if (q === void 0) {
        q = {}
        map.set(id, q)
      }

      Object.assign(q, v)
      q.listeners && q.listeners.forEach(c => c.notify(id, q))
    },
    subscribe (id, c) {
      let q = map.get(id)

      if (q === void 0) {
        q = {}
        map.set(id, q)
      }

      q.listeners = q.listeners || new Set()
      q.listeners.add(c)
    },
    unsubscribe (id, c, parallel = false) {
      const query = map.get(id)
      if (query === void 0) return;
      const listeners = query.listeners

      if (listeners) {
        // The query is not deleted because we can't be sure whether or not the component
        // responsible for this is completely 'dead' or not, that is, a nested query
        // could possibly remount in the middle of its loading.
        listeners.delete(c)
      }
    },
    setStatus: (id, v) => cache.set(id, {status: v}),
    setCommit: (id, v) => cache.set(id, {commit: v}),
    has: map.has.bind(map),
    delete: (...ids) => ids.forEach(map.delete.bind(map)),
    map (fn) {
      const output = []
      map.forEach((v, k) => output.push(fn(k, v)))
      return output
    },
    forEach: fn => map.forEach((v, k) => fn(k, v)),
    clear: map.clear.bind(map),
    getIDs: map.keys.bind(map),
    toJSON (...a) {
      const output = {}
      map.forEach((v, k) => {
        output[k] = objectWithoutProps(v, jsonExclusions)

        if (output[k].response) {
          output[k].response = objectWithoutProps(output[k].response, urlExclusion)
        }
      })

      return JSON.stringify(output, ...a)
    },
    fromJSON (json) {
      const obj = JSON.parse(json)
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        map.set(k, obj[k])
      }
    }
  }

  cache.toString = cache.toJSON
  Object.defineProperty(cache, 'size', {get: () => map.size})

  if (initialQueries && typeof initialQueries === 'object') {
    const textContent = initialQueries.firstChild.data

    if (textContent) {
      cache.fromJSON(initialQueries.textContent)
      while (initialQueries.firstChild) {
        initialQueries.removeChild(initialQueries.firstChild)
      }
    }
  }
  else if (typeof initialQueries === 'string') {
    cache.fromJSON(initialQueries)
  }

  return cache
}