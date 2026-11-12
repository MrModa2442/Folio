# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Identity Ownership Invariant**: Every document under `/users/{userId}`, `/users/{userId}/readingProgress/{bookId}`, and `/users/{userId}/pinnedNotes/{noteId}` belongs exclusively to `userId == request.auth.uid`, with `request.auth.token.email_verified == true`.
2. **Master Gate Invariant**: Sub-documents under `/users/{userId}/readingProgress/{bookId}` and `/users/{userId}/pinnedNotes/{noteId}` require that the parent `/users/{userId}` document exists and its `.data.uid == request.auth.uid`.
3. **PII Isolation Invariant**: No raw email, phone number, or physical address is stored in `/users/{userId}` (`UserProfile` only stores `uid`, `displayName`, `photoURL`, `createdAt`, `updatedAt`), and access is strictly owner-only (`request.auth.uid == userId`).
4. **Temporal & Immutability Invariant**: `createdAt == request.time` on `create`, `updatedAt == request.time` on `create` and `update`, and `uid`, `bookId`, `noteId`, and `createdAt` are immutable on `update`.
5. **Strict Key & Size Enforcement**: Every entity validation helper enforces `hasAll` and `hasOnly` on document keys, regex pattern `^[a-zA-Z0-9_\-]+$` on all IDs (`<= 128` chars), and strict `.size()` bounds on every string field.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null` attempting `create` on `/users/user_1`.
2. **Unverified Email Spoof**: `auth = { uid: 'user_1', token: { email_verified: false } }` attempting `create` on `/users/user_1`.
3. **Cross-User Profile Hijack**: `auth.uid = 'attacker'` attempting `create` or `get` on `/users/victim`.
4. **Shadow Field Injection on UserProfile**: Payload includes `{ uid: 'user_1', displayName: 'Reader', photoURL: '', isAdmin: true, createdAt: request.time, updatedAt: request.time }`.
5. **ID Poisoning Attack**: Document path `/users/user_1/readingProgress/invalid$id!with*spaces` failing `isValidId()`.
6. **Oversized String DoW Attack**: `displayName` with 500 characters (`> 100` maxLength) or `note` with 5000 characters (`> 2000` maxLength).
7. **Orphaned Subcollection Write**: Creating `/users/user_1/readingProgress/book_1` when `/users/user_1` does not exist in Firestore.
8. **Forged Client Timestamp**: Creating `/users/user_1` with `createdAt` set to a past or future timestamp (`!= request.time`).
9. **Immutable Field Mutation**: Updating `/users/user_1/readingProgress/book_1` while changing `createdAt` or `bookId` or `uid`.
10. **Unauthorized List Scraping**: Listing `/users/victim/readingProgress` when `request.auth.uid != 'victim'` or `resource.data.uid != request.auth.uid`.
11. **Value Poisoning on Update**: Updating `currentPage` with a negative integer (`-5`) or string (`"ten"`).
12. **Ghost Key on Partial Update**: Updating `/users/user_1/pinnedNotes/note_1` with an unapproved key `role: 'admin'`.
