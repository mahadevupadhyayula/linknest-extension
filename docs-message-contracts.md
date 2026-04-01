# Runtime message contract catalog

Catalog of internal runtime message types used between popup, background, and content scripts.

## Content-script request/response messages

| Type | Sender -> Receiver | Payload | Expected response |
|---|---|---|---|
| `LN_EXTRACT_PROFILE_MINIMAL` | Background -> Content | none | `{ profileUrl?, displayName?, headline? }` |
| `LN_CAPTURE_SUGGESTION_CONTEXT` | Background -> Content | none | `{ text, contextType?, highlightedText?, postText?, commentText?, postUrl?, author?, textMeta? }` |
| `LN_PROMPT_SUGGESTION_CONTEXT` | Background -> Content | none | `{ text }` |
| `LN_CONFIRM_ADD_AUTHOR_TO_TARGETS` | Background -> Content | `{ displayName }` | `{ ok, accepted }` |
| `LN_START_SHADOW` | Background -> Content | `{ mode: "name_only" }` | ack/none |
| `LN_STOP_SHADOW` | Background -> Content | none | ack/none |

## Content/background event messages

| Type | Sender -> Receiver | Payload |
|---|---|---|
| `LN_TARGET_DETECTED` | Content -> Background | detection payload |
| `LN_INTERACTION_LOG` | Content -> Background | interaction payload |

## Popup/background command messages

| Type | Payload |
|---|---|
| `LN_POPUP_GET_STATE` | none |
| `LN_POPUP_MARK_EVENT_READ` | `{ eventId }` |
| `LN_POPUP_DISMISS_EVENT` | `{ eventId }` |
| `LN_POPUP_CLEAR_EVENTS` | none |
| `LN_POPUP_REFRESH_TARGETS` | none |
| `LN_POPUP_REQUEST_SUGGESTION` | none |
| `LN_POPUP_REQUEST_SUGGESTION_MANUAL` | `{ text, contextType? }` |
| `LN_POPUP_ADD_TARGET_FROM_ACTIVE_PROFILE` | none |
| `LN_POPUP_ANALYZE_ACTIVE_PROFILE` | none |
| `LN_POPUP_REMOVE_TARGET` | `{ profileSlug }` |
| `LN_POPUP_SET_TARGET_STAGE` | `{ profileSlug, relationshipStage }` |
| `LN_POPUP_CLEAR_INTERACTION_QUEUE` | none |
| `LN_TARGETS_GET_SWR` | none |
| `LN_REQUEST_POPUP_EVENTS` | none |

## Validation behavior

`public/background/validators.js` currently enforces a subset of popup/content message types. New message types should be added to validator registry before use to avoid unknown-message rejections.
