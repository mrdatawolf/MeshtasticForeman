<template>
  <div class="fork-banner">
    <span class="fork-banner-icon">⚠️</span>
    <span>MeshtasticForeman is an independent fork and is not affiliated with or endorsed by the
      <a href="https://meshtastic.org" target="_blank" rel="noopener">official Meshtastic project</a>.
    </span>
  </div>
</template>

<style scoped>
.fork-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  background-color: rgba(234, 179, 8, 0.1);
  border-bottom: 1px solid rgba(234, 179, 8, 0.3);
  font-size: 0.85rem;
  color: #ca8a04;
  text-align: center;
  line-height: 1.5;
}

.dark .fork-banner {
  background-color: rgba(234, 179, 8, 0.08);
  border-bottom: 1px solid rgba(234, 179, 8, 0.2);
  color: #fbbf24;
}

.fork-banner a {
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.fork-banner-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
}
</style>
