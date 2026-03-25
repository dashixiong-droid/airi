import type { Emotion } from '@proj-airi/stage-ui/constants/emotions'

import { EMOTION_EmotionMotionName_value } from '@proj-airi/stage-ui/constants/emotions'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { useLive2d } from '@proj-airi/stage-ui/stores/live2d'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

export type BridgeMessage
  = | { type: 'speak', text: string, emotion?: Emotion, fakeSpeaking?: boolean }
    | { type: 'motion', motion: string }
    | { type: 'emotion', emotion: Emotion }
    | { type: 'reaction_stream', eventId?: string, chunks: string[] }
    | { type: 'state', speaking?: boolean, mouthOpenSize?: number }

const DEFAULT_BRIDGE_POLL_URL = 'http://127.0.0.1:18080/bridge/poll'

export function useBridgePoll() {
  const characterStore = useCharacterStore()
  const live2dStore = useLive2d()
  const speakingStore = useSpeakingStore()

  const { currentMotion } = storeToRefs(live2dStore)
  const { mouthOpenSize, nowSpeaking } = storeToRefs(speakingStore)

  const bridgePollUrl = ref(import.meta.env.VITE_BRIDGE_POLL_URL || DEFAULT_BRIDGE_POLL_URL)
  const pollTimer = ref<number | null>(null)

  function setEmotionAndMotion(emotion: Emotion) {
    const motion = EMOTION_EmotionMotionName_value[emotion]
    currentMotion.value = { group: motion }
  }

  async function executeBridgeMessage(message: BridgeMessage) {
    switch (message.type) {
      case 'speak': {
        if (message.emotion)
          setEmotionAndMotion(message.emotion)
        if (message.text)
          await characterStore.emitTextOutput(message.text)
        if (message.fakeSpeaking) {
          // Let the speaking pipeline drive mouth later; this is just a simple hint.
          nowSpeaking.value = true
          mouthOpenSize.value = 0.3
        }
        break
      }
      case 'motion': {
        currentMotion.value = { group: message.motion }
        break
      }
      case 'emotion': {
        setEmotionAndMotion(message.emotion)
        break
      }
      case 'reaction_stream': {
        const eventId = message.eventId || `remote-${Date.now()}`
        for (const chunk of message.chunks)
          characterStore.onSparkNotifyReactionStreamEvent(eventId, chunk)
        characterStore.onSparkNotifyReactionStreamEnd(eventId, message.chunks.join(''))
        break
      }
      case 'state': {
        if (typeof message.speaking === 'boolean')
          nowSpeaking.value = message.speaking
        if (typeof message.mouthOpenSize === 'number')
          mouthOpenSize.value = message.mouthOpenSize
        break
      }
    }
  }

  async function pollBridgeOnce() {
    try {
      const res = await fetch(bridgePollUrl.value)
      const data = await res.json()
      const items = data.items || []
      for (const item of items)
        await executeBridgeMessage(item)
    }
    catch {
      // ignore (server not running / CORS / etc.)
    }
  }

  function start() {
    if (pollTimer.value)
      return
    pollTimer.value = window.setInterval(() => {
      void pollBridgeOnce()
    }, 500)
  }

  function stop() {
    if (pollTimer.value) {
      window.clearInterval(pollTimer.value)
      pollTimer.value = null
    }
  }

  return {
    bridgePollUrl,
    start,
    stop,
  }
}
