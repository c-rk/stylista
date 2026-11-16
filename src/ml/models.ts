/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves bundled binary assets through require(). */
/** Networks bundled with the app. Both run fully on device. */
export const MODELS = {
  /** U²-Netp salient-object segmentation, 4.5 MB (Apache-2.0). */
  saliency: require('../../assets/models/u2netp.onnx') as number,
  /** MediaPipe FaceMesh landmarks, 4.9 MB (Apache-2.0), converted from the official TFLite file. */
  face: require('../../assets/models/face_landmarks.onnx') as number,
};
export type ModelName = keyof typeof MODELS;
