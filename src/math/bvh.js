import { Vec3 } from '../math/vec3.js';
import { BoundingBox } from '../shape/bounding-box.js';

const INFINITY = Number.MAX_SAFE_INTEGER;

class TLASNode {
    constructor() {
        this.aabbMin = null;
        this.leftBLAS = null;
        this.aabbMax = null;
        this.isLeaf = null;
    }
}

class TLAS {
    constructor(bvhList, N) {
        this.tlasNode = Array(2 * N);
        this.blas = bvhList;
        this.nodesUsed = 2;
        this.blasCount = N;
    }

    Build() {
        // assign a TLAS leaf node to each BLAS
        this.tlasNode[2].leftBLAS = 0;
        this.tlasNode[2].aabbMin = new Vec3(-100, -100, -100);
        this.tlasNode[2].aabbMax = new Vec3(100, 100, 100);
        this.tlasNode[2].isLeaf = true;
        this.tlasNode[3].leftBLAS = 1;
        this.tlasNode[3].aabbMin = new Vec3(-100, -100, -100);
        this.tlasNode[3].aabbMax = new Vec3(100, 100, 100);
        this.tlasNode[3].isLeaf = true;

        // create a root node over the two leaf nodes
        this.tlasNode[0].leftBLAS = 2;
        this.tlasNode[0].aabbMin = new Vec3(-100, -100, -100);
        this.tlasNode[0].aabbMax = new Vec3(100, 100, 100);
        this.tlasNode[0].isLeaf = false;
    }

    Intersect(ray) {
        let node = this.tlasNode[0];
        const stack = [];
        let stackPtr = 0;
        while (1) {
            if (node.isLeaf) {
                this.blas[node.leftBLAS].Intersect(ray);
                if (stackPtr === 0) break; else node = stack[--stackPtr];
                continue;
            }
            let child1 = this.tlasNode[node.leftBLAS];
            let child2 = this.tlasNode[node.leftBLAS + 1];
            let dist1 = intersectAABB(ray, child1.aabbMin, child1.aabbMax);
            let dist2 = intersectAABB(ray, child2.aabbMin, child2.aabbMax);
            if (dist1 > dist2) {
                [dist1, dist2] = [dist2, dist1];
                [child1, child2] = [child2, child1];
            }
            if (dist1 === INFINITY) {
                if (stackPtr === 0) break; else node = stack[--stackPtr];
            } else {
                node = child1;
                if (dist2 !== INFINITY) stack[stackPtr++] = child2;
            }
        }
    }
}

class BVHNode {
    /**
     * Create a new BVHNode
     *
     * @param {Vec3} [aabbMin] - The bounds of the BVH node
     * @param {Vec3} [aabbMax] - The bounds of the BVH node
     * @param {number} [leftFirst] - The index of the left child of the BVH node
     * @param {number} [triCount] - The number of primitives
     */
    constructor(aabbMin, aabbMax, leftFirst, triCount) {
        this.aabbMin = aabbMin || new Vec3();
        this.aabbMax = aabbMax || new Vec3();
        this.leftFirst = leftFirst || null;
        this.triCount = triCount || 0;
    }

    isLeaf() {
        return this.triCount > 0;
    }
}

class Bin {
    constructor(BINS) {
        this.BINS = BINS;
        this.bounds = new BoundingBox(new Vec3(), new Vec3());
        this.triCount = 0;
    }
}

class BVHGlobal {
    constructor(triangles) {
        this.bvhNode = [];
        this.triangles = triangles || [];
        this.triIdx = [];
        this.minDist = null;

        this.UpdateNodeBounds = this.UpdateNodeBounds.bind(this);
        this.Subdivide = this.Subdivide.bind(this);
        this.BuildBVH = this.BuildBVH.bind(this);
        this.IntersectAABB = this.IntersectAABB.bind(this);
        this.IntersectBVH = this.IntersectBVH.bind(this);

        this.BuildBVH();
    }

    UpdateNodeBounds(nodeIdx) {
        const node = this.bvhNode[nodeIdx];
        node.aabbMin = new Vec3(INFINITY, INFINITY, INFINITY);
        node.aabbMax = new Vec3(-INFINITY, -INFINITY, -INFINITY);
        const first = node.leftFirst;
        for (let i = 0; i < node.triCount; i++) {
            const leafTriIdx = this.triIdx[first + i];
            const leafTri = this.triangles[leafTriIdx];
            node.aabbMin = vec3Min(node.aabbMin, leafTri.vertex0);
            node.aabbMin = vec3Min(node.aabbMin, leafTri.vertex1);
            node.aabbMin = vec3Min(node.aabbMin, leafTri.vertex2);
            node.aabbMax = vec3Max(node.aabbMax, leafTri.vertex0);
            node.aabbMax = vec3Max(node.aabbMax, leafTri.vertex1);
            node.aabbMax = vec3Max(node.aabbMax, leafTri.vertex2);
        }
    }

    EvaluateSAH(node, axis, pos) {
        const leftBox = new BoundingBox(new Vec3(), new Vec3());
        const rightBox = new BoundingBox(new Vec3(), new Vec3());
        let leftCount = 0, rightCount = 0;
        axis = ['x', 'y', 'z'][axis];

        for (let i = 0; i < node.triCount; i++) {
            const triangle = this.triangles[this.triIdx[node.leftFirst + i]];
            if (triangle.centroid[axis] < pos) {
                leftCount++;
                leftBox.setMinMax(vec3Min(leftBox.getMin(), triangle.vertex0), vec3Max(leftBox.getMax(), triangle.vertex0));
                leftBox.setMinMax(vec3Min(leftBox.getMin(), triangle.vertex1), vec3Max(leftBox.getMax(), triangle.vertex1));
                leftBox.setMinMax(vec3Min(leftBox.getMin(), triangle.vertex2), vec3Max(leftBox.getMax(), triangle.vertex2));
            } else {
                rightCount++;
                rightBox.setMinMax(vec3Min(rightBox.getMin(), triangle.vertex0), vec3Max(rightBox.getMax(), triangle.vertex0));
                rightBox.setMinMax(vec3Min(rightBox.getMin(), triangle.vertex1), vec3Max(rightBox.getMax(), triangle.vertex1));
                rightBox.setMinMax(vec3Min(rightBox.getMin(), triangle.vertex2), vec3Max(rightBox.getMax(), triangle.vertex2));
            }
        }
        const cost = leftCount * leftBox.area() + rightCount * rightBox.area();
        return cost > 0 ? cost : INFINITY;
    }

    findBestSplitPlane(splitDetails) {
        const node = splitDetails.node;
        let bestCost = INFINITY;
        for (let a = 0; a < 3; a++) {
            const b = ['x', 'y', 'z'][a];
            // const boundsMin = node.aabbMin[b];
            // const boundsMax = node.aabbMax[b];
            let boundsMin = INFINITY;
            let boundsMax = -1 * INFINITY;
            for (let i = 0; i < node.triCount; i++) {
                const triangle = this.triangles[this.triIdx[node.leftFirst + i]];
                boundsMin = Math.min(boundsMin, triangle.centroid[b]);
                boundsMax = Math.max(boundsMax, triangle.centroid[b]);
            }
            if (boundsMin === boundsMax) continue;

            const BINS = 8;
            const bin = Array.apply(null, Array(BINS)).map(function () {
                return new Bin();
            });
            let scale = BINS / (boundsMax - boundsMin);
            for (let i = 0; i < node.triCount; i++) {
                const triangle = this.triangles[this.triIdx[node.leftFirst + i]];
                const binIdx = Math.min(BINS - 1, Math.floor((triangle.centroid[b] - boundsMin) * scale));
                bin[binIdx].triCount++;
                bin[binIdx].bounds.setMinMax(vec3Min(bin[binIdx].bounds.getMin(), triangle.vertex0), vec3Max(bin[binIdx].bounds.getMax(), triangle.vertex0));
                bin[binIdx].bounds.setMinMax(vec3Min(bin[binIdx].bounds.getMin(), triangle.vertex1), vec3Max(bin[binIdx].bounds.getMax(), triangle.vertex1));
                bin[binIdx].bounds.setMinMax(vec3Min(bin[binIdx].bounds.getMin(), triangle.vertex2), vec3Max(bin[binIdx].bounds.getMax(), triangle.vertex2));
            }
            const leftArea = Array(BINS - 1);
            const rightArea = Array(BINS - 1);
            const leftCount = Array(BINS - 1);
            const rightCount = Array(BINS - 1);

            const leftBox = new BoundingBox(new Vec3(), new Vec3());
            const rightBox = new BoundingBox(new Vec3(), new Vec3());
            let leftSum = 0;
            let rightSum = 0;

            for (let i = 0; i < BINS - 1; i++) {
                leftSum += bin[i].triCount;
                leftCount[i]  = leftSum;
                leftBox.setMinMax(vec3Min(leftBox.getMin(), bin[i].bounds.getMin()), vec3Max(leftBox.getMax(), bin[i].bounds.getMax()));
                leftArea[i] = leftBox.area();
                rightSum += bin[BINS - 1 - i].triCount;
                rightCount[BINS - 2 - i] = rightSum;
                rightBox.setMinMax(vec3Min(rightBox.getMin(), bin[BINS - 1 - i].bounds.getMin()), vec3Max(rightBox.getMax(), bin[BINS - 1 - i].bounds.getMax()));
                rightArea[BINS - 2 - i] = rightBox.area();
            }

            scale = (boundsMax - boundsMin) / BINS;
            for (let i = 0; i < 100; i++) {
                const planeCost = leftCount[i] * leftArea[i] + rightCount[i] * rightArea[i];
                if (planeCost < bestCost) {
                    splitDetails.axis = b;
                    splitDetails.splitPos = boundsMin + scale * (i + 1);
                    bestCost = planeCost;
                }
                // const candidatePos = boundsMin + i * scale;
                // const cost = this.EvaluateSAH(node, a, candidatePos);
                // if (cost < bestCost) {
                //     splitDetails.splitPos = candidatePos;
                //     splitDetails.axis = b;
                //     bestCost = cost;
                // }
            }
        }
        return bestCost;
    }

    calculateNodeCost(node) {
        const negativeAabbMin = node.aabbMin.clone();
        negativeAabbMin.mulScalar(-1);
        const extent = new Vec3();
        extent.add2(node.aabbMax, negativeAabbMin);

        const surfaceArea = extent.x * extent.y + extent.y * extent.z + extent.z * extent.x;

        return node.triCount * surfaceArea;
    }

    Subdivide(nodeIdx) {
        const node = this.bvhNode[nodeIdx];

        const splitDetails = { node: node, axis: null, splitPos: null, splitCost: null };

        const splitCost = this.findBestSplitPlane(splitDetails);

        const axis = splitDetails.axis;

        const splitPos = splitDetails.splitPos;

        const noSplitCost = this.calculateNodeCost(node);

        if (splitCost >= noSplitCost) {
            return;
        }

        // Perform the split
        let i = node.leftFirst;
        let j = i + node.triCount - 1;
        while (i <= j) {
            if (this.triangles[this.triIdx[i]].centroid[axis] < splitPos) {
                i++;
            } else {
                [this.triIdx[i], this.triIdx[j]] = [this.triIdx[j], this.triIdx[i]];
                j--;
            }
        }
        const leftCount = i - node.leftFirst;
        if (leftCount === 0 || leftCount === node.triCount) {
            return;
        }
        // Create child nodes for each half
        const leftChildIdx = this.nodesUsed++;
        const rightChildIdx = this.nodesUsed++;
        this.bvhNode[leftChildIdx].leftFirst = node.leftFirst;
        this.bvhNode[leftChildIdx].triCount = leftCount;
        this.bvhNode[rightChildIdx].leftFirst = i;
        this.bvhNode[rightChildIdx].triCount = node.triCount - leftCount;
        node.leftFirst = leftChildIdx;
        node.triCount = 0;
        this.UpdateNodeBounds(leftChildIdx);
        this.UpdateNodeBounds(rightChildIdx);
        // Recurse into each of the child nodes
        this.Subdivide(leftChildIdx);
        this.Subdivide(rightChildIdx);
    }

    /**
     * Builds the BVH
     */
    BuildBVH() {
        const N = this.triangles.length;
        this.triIdx = Array.from({ length: N }, (x, i) => i);
        this.bvhNode = Array.apply(null, Array(N * 2)).map(function () {
            return new BVHNode();
        });
        const rootNodeIdx = 0;
        this.nodesUsed = 1;

        for (let i = 0; i < N; i++) {
            this.triangles[i].centroid = new Vec3();
            this.triangles[i].centroid.add(this.triangles[i].vertex0);
            this.triangles[i].centroid.add(this.triangles[i].vertex1);
            this.triangles[i].centroid.add(this.triangles[i].vertex2);
            this.triangles[i].centroid.mulScalar(1 / 3);
        }

        const root = this.bvhNode[0];
        root.leftFirst = 0;
        root.triCount = N;
        this.UpdateNodeBounds(rootNodeIdx);
        this.Subdivide(rootNodeIdx);
    }

    RefitBVH(triangles) {
        this.triangles = triangles;
        for (let i = this.nodesUsed - 1; i >= 0; i--) {
            if (i !== 1) {
                const node = this.bvhNode[i];
                if (node.isLeaf()) {
                    // adjust bounds to contained triangles for leaf nodes
                    this.UpdateNodeBounds(i);
                    continue;
                }
                // adjust boudns to child node bounds in interior nodes
                const leftChild = this.bvhNode[node.leftFirst];
                const rightChild = this.bvhNode[node.leftFirst + 1];
                node.aabbMin = vec3Min(leftChild.aabbMin, rightChild.aabbMin);
                node.aabbMax = vec3Max(leftChild.aabbMax, rightChild.aabbMax);
            }
        }
    }

    IntersectBVH(ray, nodeIdx) {
        let node = this.bvhNode[nodeIdx];
        const stack = [];
        let stackPtr = 0;
        while (true) {
            if (node.isLeaf()) {
                for (let i = 0; i < node.triCount; i++) {
                    const dist = this.triangles[this.triIdx[node.leftFirst + i]].intersectWithRay(ray);
                    if (dist != null) {
                        if (this.minDist == null) {
                            this.minDist = dist;
                        }
                        this.minDist = Math.min(this.minDist, dist);
                    }
                }
                if (stackPtr === 0) {
                    break;
                } else {
                    node = stack[--stackPtr];
                    continue;
                }
            }
            let child1 = this.bvhNode[node.leftFirst];
            let child2 = this.bvhNode[node.leftFirst + 1];
            let dist1 = this.IntersectAABB(ray, child1.aabbMin, child1.aabbMax);
            let dist2 = this.IntersectAABB(ray, child2.aabbMin, child2.aabbMax);
            if (dist1 > dist2) {
                [dist1, dist2] = [dist2, dist1];
                [child1, child2] = [child2, child1];
            }
            if (dist1 === INFINITY) {
                if (stackPtr === 0) {
                    break;
                } else {
                    node = stack[--stackPtr];
                }
            } else {
                node = child1;
                if (dist2 !== INFINITY) {
                    stack[stackPtr++] = child2;
                }
            }
        }
    }

    IntersectAABB(ray, bmin, bmax) {
        if (ray.rD == null) {
            ray.rDx = 1 / ray.direction.x;
            ray.rDy = 1 / ray.direction.y;
            ray.rDz = 1 / ray.direction.z;
        }
        const tx1 = (bmin.x - ray.origin.x) * ray.rDx;
        const tx2 = (bmax.x - ray.origin.x) * ray.rDx;
        let tmin = Math.min(tx1, tx2);
        let tmax = Math.max(tx1, tx2);
        const ty1 = (bmin.y - ray.origin.y) * ray.rDy;
        const ty2 = (bmax.y - ray.origin.y) * ray.rDy;
        tmin = Math.max(tmin, Math.min(ty1, ty2));
        tmax = Math.min(tmax, Math.max(ty1, ty2));
        const tz1 = (bmin.z - ray.origin.z) * ray.rDz;
        const tz2 = (bmax.z - ray.origin.z) * ray.rDz;
        tmin = Math.max(tmin, Math.min(tz1, tz2));
        tmax = Math.min(tmax, Math.max(tz1, tz2));
        if (tmax >= tmin  && tmax > 0 && (this.minDist == null || (this.minDist != null && tmin < this.minDist))) {
            return tmin;
        }
        return INFINITY;
    }

    // IntersectAABB(ray, bmin, bmax) {
    //     const tx1 = (bmin.x - ray.origin.x) / ray.direction.x;
    //     const tx2 = (bmax.x - ray.origin.x) / ray.direction.x;
    //     let tmin = Math.min(tx1, tx2);
    //     let tmax = Math.max(tx1, tx2);
    //     const ty1 = (bmin.y - ray.origin.y) / ray.direction.y;
    //     const ty2 = (bmax.y - ray.origin.y) / ray.direction.y;
    //     tmin = Math.max(tmin, Math.min(ty1, ty2));
    //     tmax = Math.min(tmax, Math.max(ty1, ty2));
    //     const tz1 = (bmin.z - ray.origin.z) / ray.direction.z;
    //     const tz2 = (bmax.z - ray.origin.z) / ray.direction.z;
    //     tmin = Math.max(tmin, Math.min(tz1, tz2));
    //     tmax = Math.min(tmax, Math.max(tz1, tz2));
    //     //return tmax >= tmin && tmin < ray.t && tmax > 0;
    //     return tmax >= tmin  && tmax > 0 && (this.minDist != null && tmin < this.minDist);
    // }
}

/**
 * Create a new BVHNode
 *
 * @param {Vec3} [a] - The bounds of the BVH node
 * @param {Vec3} [b] - The bounds of the BVH node
 */
function vec3Min(a, b) {
    const c = new Vec3();
    c.set(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
    return c;
}

/**
 * Create a new BVHNode
 *
 * @param {Vec3} [a] - The bounds of the BVH node
 * @param {Vec3} [b] - The bounds of the BVH node
 * @param {Vec3} [c] - The bounds of the BVH node
 */
function vec3Max(a, b) {
    const c = new Vec3();
    c.set(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
    return c;
}

function intersectAABB(ray, bmin, bmax) {
    if (ray.rD == null) {
        ray.rDx = 1 / ray.direction.x;
        ray.rDy = 1 / ray.direction.y;
        ray.rDz = 1 / ray.direction.z;
    }
    const tx1 = (bmin.x - ray.origin.x) * ray.rDx;
    const tx2 = (bmax.x - ray.origin.x) * ray.rDx;
    let tmin = Math.min(tx1, tx2);
    let tmax = Math.max(tx1, tx2);
    const ty1 = (bmin.y - ray.origin.y) * ray.rDy;
    const ty2 = (bmax.y - ray.origin.y) * ray.rDy;
    tmin = Math.max(tmin, Math.min(ty1, ty2));
    tmax = Math.min(tmax, Math.max(ty1, ty2));
    const tz1 = (bmin.z - ray.origin.z) * ray.rDz;
    const tz2 = (bmax.z - ray.origin.z) * ray.rDz;
    tmin = Math.max(tmin, Math.min(tz1, tz2));
    tmax = Math.min(tmax, Math.max(tz1, tz2));
    if (tmax >= tmin  && tmax > 0 && (this.minDist == null || (this.minDist != null && tmin < this.minDist))) {
        return tmin;
    }
    return INFINITY;
}

export { BVHGlobal };