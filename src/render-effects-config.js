// Native WebGPU bloom is the layer that turns close emissive lamps into large
// sunshine-like halos at the left and right screen edges. Keep the response,
// but retain exactly ten percent of its previous strength.
export const EDGE_BLOOM_PREVIOUS_STRENGTH = 0.2;
export const EDGE_BLOOM_MULTIPLIER = 0.1;
export const EDGE_BLOOM_STRENGTH = EDGE_BLOOM_PREVIOUS_STRENGTH * EDGE_BLOOM_MULTIPLIER;
export const EDGE_BLOOM_RADIUS = 0.28;
export const EDGE_BLOOM_THRESHOLD = 0.87;

// These are the bright paired shapes visible beside the road in native WebGPU.
// Reduce the emissive source itself so it cannot rebuild the removed halo.
export const ONCOMING_HEADLIGHT_PREVIOUS_EMISSIVE_INTENSITY = 3.4;
export const ONCOMING_HEADLIGHT_GLARE_MULTIPLIER = 0.1;
export const ONCOMING_HEADLIGHT_EMISSIVE_INTENSITY = ONCOMING_HEADLIGHT_PREVIOUS_EMISSIVE_INTENSITY
  * ONCOMING_HEADLIGHT_GLARE_MULTIPLIER;
// RGB channels are also reduced to ten percent. Otherwise the 4.4-intensity
// daylight can still push the pale StandardMaterial base above bloom threshold.
export const ONCOMING_HEADLIGHT_BASE_COLOR = 0x1a1814;

// Close pale traffic cars were reflecting the high-intensity sun as clipped
// rectangular HDR panels. Retain ten percent of every specular contribution.
export const TRAFFIC_PAINT_SUN_REFLECTION_MULTIPLIER = 0.1;
export const TRAFFIC_PAINT_PREVIOUS_METALNESS = 0.52;
export const TRAFFIC_PAINT_METALNESS = TRAFFIC_PAINT_PREVIOUS_METALNESS
  * TRAFFIC_PAINT_SUN_REFLECTION_MULTIPLIER;
export const TRAFFIC_PAINT_PREVIOUS_CLEARCOAT = 0.82;
export const TRAFFIC_PAINT_CLEARCOAT = TRAFFIC_PAINT_PREVIOUS_CLEARCOAT
  * TRAFFIC_PAINT_SUN_REFLECTION_MULTIPLIER;
export const TRAFFIC_PAINT_SPECULAR_INTENSITY = TRAFFIC_PAINT_SUN_REFLECTION_MULTIPLIER;
export const TRAFFIC_PAINT_ROUGHNESS = 0.58;
export const TRAFFIC_PAINT_CLEARCOAT_ROUGHNESS = 0.42;
export const TRAFFIC_PAINT_LIGHTEST_COLOR = 0x686762;
