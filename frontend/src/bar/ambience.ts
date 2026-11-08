/** 本机合成的轻声，不加载音频文件。默认不播放。 */
export function createAmbience() {
  let context: AudioContext | null = null
  let stop: (() => void) | null = null

  const silence = () => {
    stop?.()
    stop = null
  }

  return {
    async set(on: boolean) {
      if (!on) {
        silence()
        if (context && context.state === 'running') await context.suspend()
        return true
      }
      const Audio = window.AudioContext
      if (!Audio) return false
      try {
        if (!context) context = new Audio()
        if (context.state === 'suspended') await context.resume()
        silence()
        const low = context.createOscillator()
        const high = context.createOscillator()
        const filter = context.createBiquadFilter()
        const gain = context.createGain()
        low.type = 'sine'
        high.type = 'sine'
        low.frequency.value = 174.61
        high.frequency.value = 220
        filter.type = 'lowpass'
        filter.frequency.value = 640
        gain.gain.value = 0.0001
        low.connect(filter)
        high.connect(filter)
        filter.connect(gain)
        gain.connect(context.destination)
        const now = context.currentTime
        gain.gain.exponentialRampToValueAtTime(0.015, now + 0.4)
        low.start()
        high.start()
        const nodes = { low, high, gain }
        stop = () => {
          const time = context!.currentTime
          nodes.gain.gain.cancelScheduledValues(time)
          nodes.gain.gain.setValueAtTime(Math.max(nodes.gain.gain.value, 0.0001), time)
          nodes.gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18)
          nodes.low.stop(time + 0.2)
          nodes.high.stop(time + 0.2)
        }
        return true
      } catch {
        silence()
        return false
      }
    },
  }
}
