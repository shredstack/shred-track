/**
 * Pure-JS tree walker for LightGBM model inference.
 *
 * Reads a LightGBM model exported as JSON (from model.dump_model())
 * and walks the decision trees to produce predictions. No native
 * dependencies — runs anywhere JavaScript runs.
 *
 * Supports:
 * - Regression (objective: regression, quantile)
 * - Binary/multiclass classification
 * - Multiple models per division (median, q10, q90)
 */

export interface TreeNode {
  split_feature?: number;
  threshold?: number;
  decision_type?: string; // "<=", default
  left_child?: TreeNode;
  right_child?: TreeNode;
  leaf_value?: number;
}

export interface TreeModel {
  name: string;
  num_class: number;
  num_tree_per_iteration: number;
  feature_names: string[];
  tree_info: Array<{
    tree_index: number;
    tree_structure: TreeNode;
  }>;
  average_output?: number;
}

/**
 * Walk a single tree node to get a leaf value.
 */
function walkTree(node: TreeNode, features: number[]): number {
  // Leaf node
  if (node.leaf_value !== undefined) {
    return node.leaf_value;
  }

  // Decision node
  const featureIdx = node.split_feature!;
  const threshold = node.threshold!;
  const featureVal = features[featureIdx] ?? 0;

  // Default decision type is "<="
  if (featureVal <= threshold) {
    return walkTree(node.left_child!, features);
  } else {
    return walkTree(node.right_child!, features);
  }
}

/**
 * Run inference on a LightGBM model.
 * Returns raw prediction (before any sigmoid/softmax for classification).
 */
export function predict(model: TreeModel, features: number[]): number {
  let sum = 0;
  for (const tree of model.tree_info) {
    sum += walkTree(tree.tree_structure, features);
  }
  // For regression, the prediction is the sum of all tree outputs
  // (LightGBM stores the initial prediction as part of the first tree)
  return sum;
}

/**
 * Run inference and return class probabilities for classification.
 */
export function predictClassification(
  model: TreeModel,
  features: number[],
): number[] {
  const numClass = model.num_class;

  if (numClass <= 1) {
    // Binary classification — sigmoid
    const rawScore = predict(model, features);
    const prob = 1 / (1 + Math.exp(-rawScore));
    return [1 - prob, prob];
  }

  // Multi-class — softmax
  const rawScores: number[] = new Array(numClass).fill(0);
  const treesPerIteration = model.num_tree_per_iteration;

  for (const tree of model.tree_info) {
    const classIdx = tree.tree_index % treesPerIteration;
    rawScores[classIdx] += walkTree(tree.tree_structure, features);
  }

  // Softmax
  const maxScore = Math.max(...rawScores);
  const expScores = rawScores.map((s) => Math.exp(s - maxScore));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  return expScores.map((e) => e / sumExp);
}

// In-memory model cache (per division × model type)
const modelCache = new Map<string, TreeModel>();

/**
 * Load a model from a URL, with in-memory caching.
 */
export async function loadModel(url: string): Promise<TreeModel> {
  const cached = modelCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load model from ${url}`);
  const model: TreeModel = await res.json();
  modelCache.set(url, model);
  return model;
}
