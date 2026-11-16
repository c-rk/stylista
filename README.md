# Stylista

3D virtual try-on for iOS and Android. A user builds a parametric 3D model of their body,
then adds clothes from a camera photo, the photo library, or the clipboard and views them
on the model from any angle. All data stays on the device.

## Stack

- Expo SDK 58 / React Native 0.88, TypeScript, Expo Router
- three.js through `@react-three/fiber` (expo-gl on device, WebGL on web)
- Reanimated for UI motion, zustand + AsyncStorage for state, expo-file-system for images

## Run

```bash
npm install
npx expo start            # dev server; press i / a, or w for the web preview
npx tsc --noEmit          # typecheck
npx expo lint             # lint
```

Camera, clipboard images, haptics and speech need a development build or Expo Go on a
real device. Store builds: `eas build -p ios` / `eas build -p android`.

## Layout

| Path | Contents |
| --- | --- |
| `src/app` | Routes: onboarding, capture, body editor, home, garment editor, `dev` harness |
| `src/screens`, `src/components` | Studio, Wardrobe, Profile, GarmentEditor, framed garment camera |
| `src/vision` | Pure TypeScript image algorithms: matting, garment scan, body measurement, face alignment, procedural silhouettes |
| `src/ml` | ONNX Runtime wrappers (native and web) and the analysis pipeline |
| `src/three/human` | Morphable body, polar body sections, cloth builder, anchors |
| `src/three` | Stage (viewer), accessories |
| `assets/body`, `assets/models` | Body mesh data, segmentation and face-landmark networks |
| `scripts/build_body.py` | Converts MakeHuman CC0 data into `assets/body/body.bin` |

## On-device pipeline

Nothing leaves the phone. Two bundled networks (9.4 MB total) run through ONNX Runtime; the
rest is geometry.

**Body.** MakeHuman CC0 base mesh (13k vertices) with 28 morph targets. Morph weights are
solved so tape-measure loops on the mesh match the requested chest, waist, hips, shoulders and
inside leg (within about 0.3 cm, about 15 ms). A fitted top and shorts are always rendered; the
model is never shown unclothed.

**Body capture.** Four hands-free poses inside an on-screen outline with head and feet limit
lines. The front and side frames are segmented, widths and depths are read from the
silhouettes at anatomical heights and converted to girths. If the person is cut off by the
frame the app says so and falls back to average proportions.

**Face.** FaceMesh landmarks are located on the front frame (crop seeded by the silhouette's
head box and refined iteratively). Eye and chin landmarks define the projection of the photo
onto the head and eyeballs; skin and hair colour are sampled from the same frame.

**Background removal.** U2-Netp saliency map, upsampled and snapped to image edges with a
guided filter, then cleaned by connected components. The garment camera shows a framing
outline and crops to it before segmentation.

**Garment scan.** From the matte: type (top, dress, skirt, trousers), torso band per row,
armpit row, sleeve axes and widths, leg extents, flat-lay versus worn. Output is an RGBA atlas
(front half and a back half with the neckline closed) plus the silhouette structure.

**Draping.** The body is sliced into polar sections (trunk, legs, arms). Cloth rings are those
sections widened to the photographed half-width at each height and relaxed toward an ellipse
where the piece stands off the body. Texture coordinates point into the atlas, whose alpha
trims neckline, hem and straps. Layers are built inside-out and each clears the ones beneath.
Pieces without a photo use procedural silhouettes through the same path.

## Verified

- Typecheck, lint, iOS and Android JS bundles.
- Browser build end to end with real product photos: import, background removal, scan,
  draping, orbit, persistence.
- Body measurement, segmentation and face alignment on sample photos in Node.

## Not verified / limits

- Not run on a physical device: camera screens, ONNX Runtime native module, speed on Hermes.
- The back of a garment is inferred from the front photo.
- A garment photographed on a person is segmented together with the person.
- Sleeves lying over the torso in the photo are not separated.
- Shoes and accessories are parametric shapes coloured from the photo, not reconstructions.
- Skin is a flat tone plus the projected face; hair is a simple cap.
- Cloud "HD reconstruction" is an opt-in setting with no endpoint configured.
- App icon and splash are Expo defaults; bundle id `com.stylista.app` is a placeholder.

## Assets and licences

- Body mesh, targets, weights: MakeHuman, CC0.
- `u2netp.onnx`: U2-Net, Apache-2.0. `face_landmarks.onnx`: MediaPipe FaceMesh, Apache-2.0,
  converted from the official TFLite file with tf2onnx.
