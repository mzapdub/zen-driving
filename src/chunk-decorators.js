import { HOUSE_STYLES, createRoadsideBuilding } from './roadside-buildings.js';
import { settlementSitesForChunk } from './world-stream.js';

export function registerStreamedHouses(worldStream) {
  if (!worldStream?.registerChunkDecorator) return () => {};
  return worldStream.registerChunkDecorator('detailed-roadside-houses', ({
    parent,
    index,
    route,
  }) => {
    const handles = [];
    for (const site of settlementSitesForChunk(index, route.environmentProfile)) {
      const heading = route.roadHeadingAt(site.routeZ);
      const roadX = route.roadXAt(site.routeZ);
      const x = roadX + Math.cos(heading) * site.side * site.offset;
      const z = site.routeZ - Math.sin(heading) * site.side * site.offset;
      const y = route.terrainHeightAt(x, z);
      const handle = createRoadsideBuilding({
        parent,
        position: [x, y, z],
        seed: site.seed,
        style: HOUSE_STYLES[site.styleIndex],
        scale: site.scale,
      });
      handle.group.lookAt(roadX, y + 1.2, site.routeZ);
      handle.group.userData.streamedSettlementSite = site;
      handles.push(handle);
    }
    return () => {
      for (const handle of handles) handle.dispose();
    };
  });
}
