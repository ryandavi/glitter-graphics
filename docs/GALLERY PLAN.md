I want you to create a detailed implementation plan for a future **user artwork gallery and remix system** for this application.

Do not implement anything yet. Do not modify the codebase. Your task is to inspect the existing project, understand its architecture and data model, and produce a practical Markdown plan that Codex could follow later.

## Core concept

Users should be able to publish artwork they create in the editor to a public or semi-public gallery.

Each published artwork should preserve:

* A rendered preview image
* The complete editable project JSON
* Canvas dimensions and relevant document settings
* Every layer and its configuration
* Swatches and colors used
* Stickers and assets used
* Fonts used
* Glitter, pattern, brush, mask, border, shadow, filter, and effect settings
* Any other reusable editor elements referenced by the artwork
* Attribution and ownership information
* Creation and publication timestamps
* The version of the project/editor schema used to create it

Other users should be able to:

* Browse artwork
* Open an artwork detail page
* See which swatches, stickers, fonts, effects, and other elements were used
* Find other artwork using the same elements
* Like or favorite artwork
* Comment on artwork, if comments are included
* Save artwork to collections
* Load another user’s artwork into the editor as a remix
* See which artwork a remix originated from
* Follow the chain of remixes back to the original
* Publish their remix as a separate artwork without altering the source

The backend should use **PHP and MySQL**.

## Architecture question

Evaluate whether a traditional MVC pattern is the best fit for this project.

Do not automatically recommend MVC just because the backend uses PHP.

Compare practical options such as:

* Traditional MVC
* A lightweight controller/service/repository structure
* Feature-based modules
* Domain-oriented modules
* A hybrid architecture suited to the project’s existing structure

Recommend the smallest architecture that:

* Fits the current codebase
* Keeps business logic out of route handlers and templates
* Avoids oversized controllers and models
* Supports future gallery, account, moderation, notification, and social features
* Can be maintained without introducing a large framework unless one is clearly justified
* Allows the editor and gallery to evolve independently
* Avoids creating parallel systems for users, assets, projects, uploads, and permissions

Explicitly describe the proposed responsibilities of:

* Routes
* Controllers or request handlers
* Services
* Repositories or database access
* Models or entities
* Validation
* Authorization policies
* View templates
* JSON/API responses
* Background or deferred jobs, if eventually needed

## Existing codebase audit

Before proposing the design, inspect the project for existing systems that the gallery should reuse.

Look for:

* User or session handling
* Authentication
* Project serialization
* JSON export/import
* Save/load functionality
* Asset registries
* Sticker managers
* Swatch or palette systems
* Font registries
* Layer serialization
* Upload handling
* File storage abstractions
* Database access helpers
* Routing
* Templates or reusable UI components
* Modal and notification systems
* Existing IDs used for editor resources
* Schema versioning or migration utilities
* Validation and sanitization utilities

Identify any existing manager, service, controller, registry, store, renderer, serializer, or component system that should be extended instead of duplicated.

Call out:

* Duplicate or parallel systems that must be avoided
* State currently duplicated or synchronized manually
* Logic assigned to the wrong layer
* Tight coupling or hidden dependencies
* APIs that expose internal implementation details
* Features that should integrate with existing systems
* Shared behavior currently implemented separately
* Long conditional chains that should use registries, configuration, strategies, maps, or composition
* Areas where adding the gallery would create architectural pressure

## Membership and identity

Evaluate whether the gallery requires a membership system.

Assume that publishing, liking, commenting, saving, following, and remix attribution require persistent user identities.

Recommend an account model that can begin simply but support future expansion.

Consider:

* Guest editor usage without an account
* Requiring an account only when saving or publishing
* Email/password accounts
* Passwordless email login
* Social login as a later option
* Display names and usernames
* Profile pages
* Avatars
* Account privacy
* Public, unlisted, private, and draft artwork
* Block and mute functionality
* Roles such as user, moderator, and administrator
* Account deletion
* Data export
* Ownership transfer or preservation of remix history after account deletion

Explain which account features are required for the first gallery version and which should be deferred.

Do not design a paid subscription system unless there is a clear product reason. Distinguish between:

* Membership as user accounts and identity
* Paid memberships or premium subscriptions

## Artwork and project storage

Design how published artwork should be stored.

Each artwork may need:

* A database record
* A rendered thumbnail
* One or more preview image sizes
* The editable project JSON
* Searchable metadata
* References to reusable assets
* Publication status
* Moderation status
* Remix relationships
* Version history

Evaluate whether the project JSON should be stored:

* Directly in MySQL as JSON
* As a file with a database reference
* As compressed JSON
* As immutable snapshots
* Through a hybrid approach

Recommend a strategy based on:

* Expected project size
* Query needs
* Versioning
* backup and restore
* schema migrations
* performance
* portability
* corruption recovery
* storage growth

The published project should remain reproducible even when the editor changes.

Include a plan for:

* `schema_version`
* Project migrations
* Backward compatibility
* Unknown or removed layer types
* Missing assets
* Deprecated settings
* Immutable published snapshots
* Editing an already published artwork
* Republishing or creating a new revision

## Resource and element tracking

Artwork should be discoverable by the elements used to create it.

Design a normalized system for tracking resources such as:

* Stickers
* User-uploaded stickers
* Swatches
* Palettes
* Fonts
* Glitter textures
* Patterns
* Brushes
* Shapes
* Masks
* Effects
* Filters
* Templates
* Other reusable editor assets

Avoid storing only human-readable names, because names may change or collide.

Recommend stable identifiers for editor resources.

Consider tables or relationships such as:

* `artworks`
* `artwork_resources`
* `resources`
* `resource_types`
* `artwork_colors`
* `artwork_fonts`
* `artwork_stickers`

Decide whether one generalized resource relationship or several typed relationship tables would be easier to maintain and query.

Explain how the application could support pages or filters such as:

* More artwork using this sticker
* More artwork using this palette
* Artwork using this font
* Artwork using similar colors
* Artwork created with a particular template
* Artwork using a combination of selected elements

Clarify which metadata should be extracted from project JSON and stored separately for indexing, rather than queried directly from the JSON.

## Locally uploaded stickers and other private assets

Develop a clear strategy for artwork that includes stickers or images uploaded locally by the creator.

Address:

* Whether uploaded assets are embedded in project JSON
* Whether they are uploaded to server storage when publishing
* Content-addressed storage using file hashes
* Deduplication
* Ownership
* Licensing and user attestations
* Attribution
* File size limits
* Supported formats
* Image sanitization and re-encoding
* SVG safety
* EXIF removal
* Malware checks
* Storage quotas
* Asset deletion
* What happens when an artwork using that asset is remixed
* Whether remixers receive a copy, a reference, or no access
* Whether private assets can appear in public artwork
* Whether source files should be downloadable
* Whether uploaded assets become reusable public gallery resources
* How to prevent one user from gaining unintended access to another user’s private uploads

Recommend a distinction between:

* Built-in public assets
* Creator-owned reusable assets
* Artwork-bound uploaded assets
* Private account assets
* Public community assets

Published artwork must not break merely because the creator later deletes an item from their personal asset library.

## Remix system

Design remixing as a first-class relationship rather than a simple duplicate button.

Each remix should preserve:

* The source artwork ID
* The root/original artwork ID
* The remixing user
* The project snapshot that was loaded
* The time the remix was created
* Attribution shown publicly
* Any changes in resource usage
* Whether the source permits remixing

Consider:

* Remix permission settings
* Public-domain-like remixing versus attribution-required remixing
* Disabling remixing
* Remixing an unlisted artwork
* Remixing deleted or moderated artwork
* Remix chains
* Remix trees
* Fork counts
* Preventing attribution removal
* Whether users can remix their own artwork
* Whether a remix stores a full independent snapshot
* Whether updates to the source should ever affect existing remixes

Recommend that remixes remain independent snapshots and explain any tradeoffs.

## Gallery and discovery features

Recommend a sensible gallery feature set.

Evaluate features such as:

* Recent
* Trending
* Most liked
* Most remixed
* Following feed
* Staff picks
* Random artwork
* Tags
* Search
* Resource-based filtering
* Color-based discovery
* Collections
* Favorites
* User profiles
* Artist follow system
* View counts
* Remix counts
* Download counts
* Related artwork
* Drafts
* Scheduled publishing
* Unlisted sharing links
* Embeds
* Reporting
* Content warnings
* Notifications
* Activity feeds

Separate these into:

* Essential first version
* Strong second-phase additions
* Later or optional features
* Features that create major moderation or scaling costs

Be conservative about social features that require substantial moderation.

## Likes, favorites, collections, and comments

Decide whether likes and favorites should be the same concept.

Consider whether the product would be clearer with:

* One lightweight “like” action
* A private “save” action
* User-created collections
* Public or private collections

For comments, evaluate:

* Whether comments should be included initially
* Threaded versus flat comments
* Editing and deletion
* Mentions
* Rate limits
* Spam prevention
* Reporting
* Moderator removal
* Artwork owner controls
* Blocking users
* Notification volume

Recommend whether comments should be deferred until moderation tools are ready.

## Database planning

Propose a preliminary MySQL schema.

Include likely tables, responsibilities, and major relationships for:

* Users
* User profiles
* Sessions or authentication identities
* Artwork
* Artwork revisions or snapshots
* Artwork resources
* Uploaded assets
* Likes
* Saves or favorites
* Collections
* Collection items
* Comments
* Follows
* Remix relationships
* Tags
* Reports
* Moderation actions
* Notifications
* View or engagement events, if needed

For each major table, identify:

* Primary key strategy
* Foreign keys
* Important unique constraints
* Important indexes
* Soft deletion versus hard deletion
* Created and updated timestamps
* Status fields
* Public identifiers versus internal numeric identifiers

Do not produce exhaustive SQL unless small examples clarify the plan.

Address how to avoid:

* Duplicate likes
* Duplicate collection entries
* Broken remix ancestry
* Orphaned uploaded assets
* Username collisions
* N+1 queries
* Expensive counts on every gallery request
* Querying large JSON documents during gallery browsing

## API and route planning

Propose route groups or endpoints for:

* Authentication
* Profiles
* Artwork publishing
* Artwork updates
* Artwork deletion
* Draft saving
* Gallery browsing
* Artwork detail
* Likes
* Saves
* Collections
* Comments
* Remix creation
* Resource detail and discovery
* Uploads
* Reports
* Moderation

Distinguish between:

* Server-rendered pages
* JSON API routes used by the editor
* Form submissions
* Asynchronous actions

Recommend consistent response and validation patterns.

Include authorization rules for all write actions.

## Publishing workflow

Plan the publishing flow from the editor.

A possible flow may include:

1. Validate the current document.
2. Serialize the project.
3. Gather referenced resource IDs.
4. Detect locally uploaded assets.
5. Upload or bind required asset files.
6. Generate a preview image.
7. Validate title, description, tags, and visibility.
8. Create an immutable project snapshot.
9. Store indexed metadata.
10. Publish the artwork.
11. Queue additional thumbnail sizes or analysis if needed.

Evaluate whether preview generation should happen:

* In the browser
* On the server
* Both, with server verification
* Through an eventual background job

Plan for failed or interrupted publishing without leaving orphaned records or files.

## Security

Include a security review covering:

* Authentication and session security
* CSRF
* XSS
* SQL injection
* Authorization checks
* Insecure direct object references
* Upload validation
* MIME spoofing
* SVG script injection
* Image decompression bombs
* JSON size and nesting limits
* Rate limiting
* Spam
* Comment abuse
* Username impersonation
* Private artwork access
* Signed or unguessable asset URLs
* Preventing arbitrary project JSON from invoking unsafe editor behavior
* Sanitizing artwork titles, descriptions, tags, and comments
* Preventing users from publishing references to assets they do not own or cannot access

Assume all client-provided project JSON and resource IDs are untrusted.

## Moderation and legal concerns

Plan the minimum moderation foundation required before allowing public uploads.

Consider:

* Reporting artwork
* Reporting comments
* Reporting users
* Copyright complaints
* User-uploaded copyrighted or abusive imagery
* Nudity or sensitive content
* Spam
* Harassment
* Impersonation
* Moderator roles
* Audit logs
* Content removal
* Account suspension
* Appeal notes
* Artwork visibility changes
* Preserving evidence after public removal
* Terms acceptance
* Privacy policy implications
* Remix permissions and attribution
* Licensing declarations for uploaded assets

Do not overbuild an automated moderation system, but identify what must exist before launch.

## Performance and scalability

Assume the initial gallery may be small, but avoid decisions that become immediate bottlenecks.

Plan for:

* Pagination using cursors where appropriate
* Thumbnail generation
* CDN-compatible asset URLs
* Object storage compatibility
* Database indexing
* Cached counts
* Denormalized artwork summary fields where justified
* Search evolution from MySQL search to a dedicated search system later
* Trending calculations
* Image and JSON storage growth
* Cleanup of abandoned uploads
* Background jobs
* Rate limiting
* Feed generation
* Avoiding large project JSON downloads on gallery listing pages

The first version should still be deployable without requiring Redis, Elasticsearch, queues, microservices, or cloud object storage. Explain where abstraction boundaries should exist so those can be introduced later.

## User experience

Describe the major user flows:

* Browse gallery as a guest
* Create artwork as a guest
* Sign up when attempting to save or publish
* Publish artwork
* Edit artwork metadata
* Save a private draft
* View an artwork
* Inspect its resources
* Like or save it
* Remix it
* Publish the remix
* View the remix lineage
* Manage personal uploads
* Delete an artwork
* Delete an account

Clarify what happens when:

* The source artwork is deleted
* The source artwork becomes private
* A resource is removed
* A remix is reported
* A user is blocked
* The editor can no longer understand part of an old project
* An artwork is published with a font or asset unavailable to another user

## Testing strategy

Recommend tests for:

* Project serialization and deserialization
* Schema migrations
* Publishing
* Resource extraction
* Asset ownership
* Remix ancestry
* Permissions
* Private and unlisted artwork
* Duplicate likes and saves
* Comment moderation
* Account deletion
* File upload validation
* Missing assets
* Backward compatibility
* Database constraints
* Transaction rollback
* Gallery pagination
* API validation
* Security-sensitive routes

Separate unit, integration, database, and end-to-end tests.

## Deliverable

Create a Markdown planning document in the most appropriate planning or documentation location in the repository.

The plan should include:

1. Executive summary
2. Findings from the current codebase
3. Recommended architecture
4. Membership recommendation
5. Proposed domain model
6. Proposed database structure
7. Project JSON and versioning strategy
8. Asset and upload strategy
9. Remix model
10. Gallery and social feature recommendations
11. Security and moderation requirements
12. API and route structure
13. Publishing workflow
14. Phased implementation roadmap
15. Testing strategy
16. Risks and unresolved decisions
17. Specific files or systems likely to be added or changed later

For the roadmap, use phases such as:

* Phase 0: architectural preparation
* Phase 1: accounts and private project saving
* Phase 2: basic publishing and public gallery
* Phase 3: resource indexing and remixing
* Phase 4: likes, saves, collections, and profiles
* Phase 5: comments, following, notifications, and moderation expansion
* Phase 6: search, recommendations, and scaling improvements

For every phase include:

* Goals
* Dependencies
* Database changes
* Backend work
* Frontend work
* Security considerations
* Tests
* Migration concerns
* What should explicitly not be implemented yet

Prioritize recommendations by:

* High, medium, or low impact
* High, medium, or low implementation effort
* Required, recommended, or optional

Make concrete recommendations rather than listing possibilities without choosing among them.

The final plan should be detailed enough for Codex to implement later one phase at a time, while preserving the current editor’s behavior and avoiding unnecessary rewrites.
