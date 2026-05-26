import { debugLog } from '../utils/Debug.js';
import {
  updateTodoItemFromDialog,
  addTodoItemFromDialog,
  deleteTodoItemFromDialog,
  deleteCompletedItems,
  entitySupportsFeature
} from '../features/TodoOperations.js';

/**
 * DialogManager handles all dialog-related functionality for TodoSwipeCard
 * Manages todo item edit, add, and delete dialogs
 */
export class DialogManager {
  constructor(cardInstance) {
    this.cardInstance = cardInstance;
    this.currentDialog = null; // Track current open dialog
    this.dialogOpenTime = 0; // Prevent rapid dialog creation
  }

  /**
   * Get hass object from card instance
   * @returns {Object} Home Assistant object
   * @private
   */
  get _hass() {
    return this.cardInstance._hass;
  }

  /**
   * Get config object from card instance
   * @returns {Object} Card configuration
   * @private
   */
  get _config() {
    return this.cardInstance._config;
  }

  /**
   * Create a custom delete button that looks like ha-button but is fully styleable.
   * @param {string} text - Button text
   * @param {string} slot - Button slot
   * @returns {HTMLElement} Custom delete button
   * @private
   */
  _createCustomDeleteButton(text, slot) {
    const button = document.createElement('button');
    button.slot = slot;
    button.textContent = text;
    button.setAttribute('destructive', '');

    // Style it to look like ha-button but with red color
    button.style.cssText = `
      background-color: #f44336;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-family: var(--mdc-typography-button-font-family, inherit);
      font-size: var(--mdc-typography-button-font-size, 0.875rem);
      font-weight: var(--mdc-typography-button-font-weight, 500);
      text-transform: uppercase;
      letter-spacing: 0.0892857143em;
      cursor: pointer;
      min-width: 64px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      transition: background-color 0.2s, box-shadow 0.2s;
      outline: none;
    `;

    // Add hover and focus effects
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#d32f2f';
      button.style.boxShadow = '0px 2px 4px rgba(244, 67, 54, 0.3)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#f44336';
      button.style.boxShadow = 'none';
    });

    button.addEventListener('focus', () => {
      button.style.backgroundColor = '#d32f2f';
      button.style.boxShadow = '0px 0px 0px 2px rgba(244, 67, 54, 0.3)';
    });

    button.addEventListener('blur', () => {
      button.style.backgroundColor = '#f44336';
      button.style.boxShadow = 'none';
    });

    return button;
  }

  /**
   * Create a built-in-style destructive text action button.
   * @param {string} text - Button text
   * @param {string} slot - Button slot
   * @returns {HTMLElement} Delete action button
   * @private
   */
  _createDeleteActionButton(text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = `
      border: 0;
      background: transparent;
      color: var(--error-color, #f44336);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      padding: 8px 0;
    `;
    return button;
  }

  /**
   * Create a regular button that matches ha-button styling.
   * @param {string} text - Button text
   * @param {string} slot - Button slot
   * @returns {HTMLElement} Regular button
   * @private
   */
  _createRegularButton(text, slot) {
    const button = document.createElement('ha-button');
    button.slot = slot;
    button.textContent = text;
    return button;
  }

  /**
   * Edit todo item using a custom HA-style dialog.
   * @param {string} entityId - Entity ID
   * @param {Object} item - Todo item (may be stale from closure)
   */
  editTodoItem(entityId, item) {
    // Prevent rapid dialog creation (debounce)
    const now = Date.now();
    if (now - this.dialogOpenTime < 300) {
      debugLog('Preventing rapid dialog creation');
      return;
    }
    this.dialogOpenTime = now;

    // Look up fresh item data from cache instead of using stale closure data
    const freshItem = this._getFreshItemData(entityId, item.uid);
    if (!freshItem) {
      debugLog(`Could not find fresh data for item ${item.uid}, using stale data`);
      this.showTodoItemEditDialog(entityId, item);
      return;
    }

    debugLog(`Edit todo item "${freshItem.summary}" in ${entityId} (using fresh data)`);
    this.showTodoItemEditDialog(entityId, freshItem);
  }

  /**
   * Get fresh item data from cache.
   * @param {string} entityId - Entity ID
   * @param {string} itemUid - Item UID
   * @returns {Object|null} Fresh item data or null if not found
   * @private
   */
  _getFreshItemData(entityId, itemUid) {
    if (!this.cardInstance._todoItemsCache) {
      return null;
    }

    const cachedItems = this.cardInstance._todoItemsCache.get(entityId);
    if (!cachedItems) {
      return null;
    }

    return cachedItems.find((it) => it.uid === itemUid) || null;
  }

  /**
   * Show todo item edit dialog with full HA native features.
   * @param {string} entityId - Entity ID
   * @param {Object} item - Todo item (undefined for new items)
   */
  showTodoItemEditDialog(entityId, item = undefined) {
    // Close any existing dialog first
    this.closeCurrentDialog();

    debugLog(`Opening todo edit dialog for ${item ? 'existing' : 'new'} item`);

    // Create dialog with HA's native styling and accessibility
    const dialog = document.createElement('ha-dialog');
    dialog.heading = '';
    dialog.open = true;
    dialog.style.setProperty('--mdc-dialog-min-width', 'min(600px, 95vw)');
    dialog.style.setProperty('--mdc-dialog-max-width', 'min(600px, 95vw)');

    // ------------------------------------------------------------------------
    // Theme bridge for native + HA/MDC/Web Awesome form controls in this dialog.
    //
    // Public --todo-swipe-* variables stay user-overridable. Inline styles only
    // define *-default values, then every consumer reads var(public, default).
    // ------------------------------------------------------------------------
    const inheritedTheme = getComputedStyle(this.cardInstance);
    const themeValue = (names, fallback) => {
      for (const name of names) {
        const value = inheritedTheme.getPropertyValue(name).trim();
        if (value) {
          return value;
        }
      }
      return fallback;
    };
    const copyPublicThemeValue = (name) => {
      const value = inheritedTheme.getPropertyValue(name).trim();
      if (value) {
        dialog.style.setProperty(name, value);
      }
    };

    [
      '--todo-swipe-dialog-surface',
      '--todo-swipe-field-background',
      '--todo-swipe-field-background-hover',
      '--todo-swipe-field-background-disabled',
      '--todo-swipe-field-text',
      '--todo-swipe-field-label',
      '--todo-swipe-field-border',
      '--todo-swipe-field-accent'
    ].forEach(copyPublicThemeValue);

    const dialogSurface =
      'var(--todo-swipe-dialog-surface, var(--todo-swipe-dialog-surface-default))';
    const fieldBackground =
      'var(--todo-swipe-field-background, var(--todo-swipe-field-background-default))';
    const fieldBackgroundHover =
      'var(--todo-swipe-field-background-hover, var(--todo-swipe-field-background-hover-default))';
    const fieldBackgroundDisabled =
      'var(--todo-swipe-field-background-disabled, var(--todo-swipe-field-background-disabled-default))';
    const fieldText = 'var(--todo-swipe-field-text, var(--todo-swipe-field-text-default))';
    const fieldLabel = 'var(--todo-swipe-field-label, var(--todo-swipe-field-label-default))';
    const fieldBorder = 'var(--todo-swipe-field-border, var(--todo-swipe-field-border-default))';
    const fieldAccent = 'var(--todo-swipe-field-accent, var(--todo-swipe-field-accent-default))';

    dialog.style.setProperty(
      '--todo-swipe-dialog-surface-default',
      themeValue(
        [
          '--ha-dialog-surface-background',
          '--dialog-background-color',
          '--card-background-color',
          '--primary-background-color'
        ],
        '#1c1c1e'
      )
    );
    dialog.style.setProperty(
      '--todo-swipe-field-background-default',
      themeValue(
        ['--ha-color-form-background', '--input-fill-color', '--mdc-text-field-fill-color'],
        'rgba(255,255,255,0.08)'
      )
    );
    dialog.style.setProperty(
      '--todo-swipe-field-background-hover-default',
      themeValue(['--ha-color-form-background-hover'], fieldBackground)
    );
    dialog.style.setProperty(
      '--todo-swipe-field-background-disabled-default',
      themeValue(
        ['--ha-color-form-background-disabled', '--input-disabled-fill-color'],
        fieldBackground
      )
    );
    dialog.style.setProperty(
      '--todo-swipe-field-text-default',
      themeValue(['--ha-color-text-primary', '--primary-text-color'], '#fff')
    );
    dialog.style.setProperty(
      '--todo-swipe-field-label-default',
      themeValue(['--ha-color-text-secondary', '--secondary-text-color'], 'rgba(255,255,255,0.7)')
    );
    dialog.style.setProperty(
      '--todo-swipe-field-border-default',
      themeValue(['--ha-color-border-neutral-loud', '--divider-color'], 'rgba(255,255,255,0.2)')
    );
    dialog.style.setProperty(
      '--todo-swipe-field-accent-default',
      themeValue(['--accent-color', '--primary-color'], '#ff9f09')
    );

    // Feed the dialog surface itself
    dialog.style.setProperty('--ha-dialog-surface-background', dialogSurface);
    dialog.style.setProperty('--mdc-dialog-surface-color', dialogSurface);

    // Feed modern HA semantic form vars
    dialog.style.setProperty('--ha-color-form-background', fieldBackground);
    dialog.style.setProperty('--ha-color-form-background-hover', fieldBackgroundHover);
    dialog.style.setProperty('--ha-color-form-background-disabled', fieldBackgroundDisabled);
    dialog.style.setProperty('--ha-color-text-primary', fieldText);
    dialog.style.setProperty('--ha-color-text-secondary', fieldLabel);

    // Feed legacy HA input vars
    dialog.style.setProperty('--input-fill-color', fieldBackground);
    dialog.style.setProperty('--input-disabled-fill-color', fieldBackgroundDisabled);
    dialog.style.setProperty('--input-ink-color', fieldText);
    dialog.style.setProperty('--input-label-ink-color', fieldLabel);
    dialog.style.setProperty(
      '--input-disabled-ink-color',
      'var(--disabled-text-color, rgba(255,255,255,0.38))'
    );
    dialog.style.setProperty('--input-idle-line-color', fieldBorder);
    dialog.style.setProperty('--input-hover-line-color', fieldAccent);
    dialog.style.setProperty('--input-dropdown-icon-color', fieldText);

    // Feed MDC vars used by ha-textfield / older controls
    dialog.style.setProperty('--mdc-text-field-fill-color', fieldBackground);
    dialog.style.setProperty('--mdc-text-field-hover-fill-color', fieldBackgroundHover);
    dialog.style.setProperty('--mdc-text-field-disabled-fill-color', fieldBackgroundDisabled);
    dialog.style.setProperty('--mdc-text-field-ink-color', fieldText);
    dialog.style.setProperty('--mdc-text-field-label-ink-color', fieldLabel);
    dialog.style.setProperty('--mdc-text-field-idle-line-color', fieldBorder);
    dialog.style.setProperty('--mdc-text-field-hover-line-color', fieldAccent);
    dialog.style.setProperty('--mdc-select-fill-color', fieldBackground);
    dialog.style.setProperty('--mdc-select-disabled-fill-color', fieldBackgroundDisabled);
    dialog.style.setProperty('--mdc-select-ink-color', fieldText);
    dialog.style.setProperty('--mdc-select-label-ink-color', fieldLabel);

    // ------------------------------------------------------------------------

    // Add accessibility attributes
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.setAttribute('aria-modal', 'true');

    // Track this dialog
    this.currentDialog = dialog;

    // Create content container
    const content = document.createElement('div');
    content.style.cssText = `
      padding: 8px 22px 0 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    `;

    // Get entity state and features
    const entityState = this._hass?.states?.[entityId];
    const entityName = entityState?.attributes?.friendly_name || entityId;
    const showExtendedFields = this._config.show_extended_edit_fields === true;
    const supportsDescription =
      showExtendedFields && entityState && entitySupportsFeature(entityState, 64);
    const supportsDueDate =
      showExtendedFields &&
      entityState &&
      (entitySupportsFeature(entityState, 16) || entitySupportsFeature(entityState, 32));
    const supportsDelete = entityState && entitySupportsFeature(entityState, 2);

    // Debug the feature support
    debugLog(`Entity features for ${entityId}:`, {
      supportedFeatures: entityState?.attributes?.supported_features,
      supportsDescription: supportsDescription,
      supportsDueDate: supportsDueDate,
      supportsDelete: supportsDelete
    });

    const header = document.createElement('div');
    header.style.cssText = `
      margin-left: 36px;
      margin-top: -4px;
      min-height: 38px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    `;

    const title = document.createElement('div');
    title.textContent = item ? 'Edit item' : 'Add Todo Item';
    title.style.cssText = `
      color: var(--primary-text-color);
      font-size: 20px;
      font-weight: 500;
      line-height: 21px;
    `;

    const subtitle = document.createElement('div');
    subtitle.textContent = entityName;
    subtitle.style.cssText = `
      color: var(--secondary-text-color);
      font-size: 14px;
      line-height: 17px;
      margin-top: 0;
    `;

    header.appendChild(title);
    header.appendChild(subtitle);
    content.appendChild(header);

    // Create summary/checkbox row
    const summaryRow = document.createElement('div');
    summaryRow.style.cssText = 'display: flex; align-items: flex-start; gap: 24px; margin-top: 0;';

    // Checkbox for completion status (only for existing items)
    let checkbox = null;
    if (item) {
      checkbox = document.createElement('ha-checkbox');
      checkbox.checked = item.status === 'completed';
      checkbox.style.marginTop = '13px';
      summaryRow.appendChild(checkbox);
    }

    // Summary input with validation
    const summaryFieldWrapper = document.createElement('label');
    summaryFieldWrapper.style.cssText = `
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      color: ${fieldLabel};
      font-size: 12px;
      font-weight: 500;
      line-height: 15px;
      max-width: calc(100% - 48px);
    `;

    const summaryLabel = document.createElement('span');
    summaryLabel.textContent = 'Task name*';
    summaryLabel.style.cssText = `
      color: ${fieldAccent};
      margin-bottom: 1px;
    `;

    const summaryField = document.createElement('input');
    summaryField.type = 'text';
    summaryField.value = item?.summary || '';
    summaryField.required = true;
    summaryField.setAttribute('aria-label', 'Task name');
    summaryField.style.cssText = `
      width: 100%;
      box-sizing: border-box;
      border: 0;
      border-bottom: 2px solid ${fieldAccent};
      border-radius: 0;
      background: transparent;
      color: ${fieldText};
      font: inherit;
      font-size: 16px;
      line-height: 21px;
      padding: 0 0 6px 0;
      outline: none;
    `;

    summaryFieldWrapper.appendChild(summaryLabel);
    summaryFieldWrapper.appendChild(summaryField);
    summaryRow.appendChild(summaryFieldWrapper);

    content.appendChild(summaryRow);

    // Description field
    let descriptionField = null;
    if (supportsDescription) {
      // Create a wrapper for proper styling
      const textareaWrapper = document.createElement('div');
      textareaWrapper.style.cssText = `
        width: 100%;
        margin-bottom: 16px;
        position: relative;
      `;

      // Create label
      const label = document.createElement('label');
      label.textContent = 'Description';
      label.style.cssText = `
        display: block;
        font-size: 12px;
        color: ${fieldLabel};
        margin-bottom: 4px;
      `;

      // Create textarea
      descriptionField = document.createElement('textarea');
      descriptionField.value = item?.description || '';
      descriptionField.rows = 3;
      descriptionField.style.cssText = `
        width: 100%;
        min-height: 60px;
        max-height: 200px;
        padding: 8px;
        border: none;
        border-bottom: 1px solid ${fieldBorder};
        border-radius: 4px 4px 0 0;
        background: ${fieldBackground};
        color: ${fieldText};
        font-family: var(--mdc-typography-body1-font-family, inherit);
        font-size: var(--mdc-typography-body1-font-size, 1rem);
        line-height: 1.5;
        resize: vertical;
        box-sizing: border-box;
        outline: none;
        transition: border-bottom-color 0.15s ease;
      `;

      // Focus styling
      descriptionField.addEventListener('focus', () => {
        descriptionField.style.borderBottomColor = fieldAccent;
        descriptionField.style.borderBottomWidth = '2px';
      });

      descriptionField.addEventListener('blur', () => {
        descriptionField.style.borderBottomColor = fieldBorder;
        descriptionField.style.borderBottomWidth = '1px';
      });

      textareaWrapper.appendChild(label);
      textareaWrapper.appendChild(descriptionField);
      content.appendChild(textareaWrapper);
      debugLog('Description field (native textarea) added to dialog');
    }

    // Due date field (if supported)
    let dateField = null;
    let timeField = null;
    if (supportsDueDate) {
      const dueSection = document.createElement('div');

      // Create the "Due date:" label
      const dueLabel = document.createElement('span');
      dueLabel.className = 'label';
      dueLabel.textContent = 'Due date:';
      dueLabel.style.cssText = `
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--input-label-ink-color, var(--primary-text-color));
        display: block;
        margin-bottom: 8px;
      `;
      dueSection.appendChild(dueLabel);

      // Create flex container for date and time inputs
      const flexContainer = document.createElement('div');
      flexContainer.className = 'flex';
      flexContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
        gap: 16px;
      `;

      // Parse existing due date
      let dueDate = '';
      let dueTime = '';
      if (item?.due) {
        try {
          const due = new Date(item.due);
          if (!isNaN(due.getTime())) {
            dueDate = due.toISOString().split('T')[0]; // YYYY-MM-DD format
            if (item.due.includes('T')) {
              dueTime = due.toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
            }
          }
        } catch (e) {
          debugLog('Error parsing due date:', e);
        }
      }

      // Create date input
      const dateContainer = document.createElement('div');
      dateContainer.style.cssText = `flex-grow: 1; position: relative;`;

      dateField = document.createElement('input');
      dateField.type = 'date';
      dateField.value = dueDate;
      dateField.style.cssText = `
        width: 100%;
        height: 56px;
        padding: 20px 36px 6px 12px;
        border: none;
        border-bottom: 1px solid ${fieldBorder};
        border-radius: 0;
        background: transparent;
        color: ${fieldText};
        font-family: var(--mdc-typography-subtitle1-font-family, inherit);
        font-size: var(--mdc-typography-subtitle1-font-size, 1rem);
        line-height: var(--mdc-typography-subtitle1-line-height, 1.75rem);
        box-sizing: border-box;
        outline: none;
        transition: border-bottom-color 0.15s ease;
        cursor: pointer;
        -webkit-appearance: none;
        -moz-appearance: textfield;
      `;

      // Create wrapper
      const dateWrapper = document.createElement('div');
      dateWrapper.style.cssText = `
        position: relative;
        background: ${fieldBackground};
        border-radius: 4px 4px 0 0;
        min-height: 56px;
        display: flex;
        align-items: center;
      `;

      // Create floating label for date field
      const dateLabel = document.createElement('span');
      dateLabel.textContent = 'Due Date';
      dateLabel.style.cssText = `
        position: absolute;
        left: 12px;
        top: 8px;
        font-size: 12px;
        color: ${fieldLabel};
        pointer-events: none;
        transition: all 0.2s ease;
      `;

      // Add clear functionality
      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.innerHTML = '×';
      clearButton.style.cssText = `
        position: absolute;
        right: 36px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: ${fieldLabel};
        font-size: 18px;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: ${dueDate ? 'flex' : 'none'};
        align-items: center;
        justify-content: center;
        z-index: 2;
      `;

      clearButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dateField.value = '';
        clearButton.style.display = 'none';
        if (timeField) {
          timeField.value = '';
        }
      });

      // Show/hide clear button based on input value
      dateField.addEventListener('input', () => {
        clearButton.style.display = dateField.value ? 'flex' : 'none';
      });

      dateWrapper.appendChild(dateLabel);
      dateWrapper.appendChild(dateField);
      dateWrapper.appendChild(clearButton);
      dateContainer.appendChild(dateWrapper);
      flexContainer.appendChild(dateContainer);

      // Create time input if datetime is supported
      if (entitySupportsFeature(entityState, 32)) {
        const timeContainer = document.createElement('div');
        timeContainer.style.cssText = `position: relative; min-width: 120px;`;

        const timeWrapper = document.createElement('div');
        timeWrapper.style.cssText = `
          position: relative;
          background: ${fieldBackground};
          border-radius: 4px 4px 0 0;
          min-height: 56px;
          display: flex;
          align-items: center;
        `;

        timeField = document.createElement('input');
        timeField.type = 'time';
        timeField.value = dueTime;
        timeField.style.cssText = `
          width: 100%;
          height: 56px;
          padding: 20px 12px 6px 12px;
          border: none;
          border-bottom: 1px solid ${fieldBorder};
          border-radius: 0;
          background: transparent;
          color: ${fieldText};
          font-family: var(--mdc-typography-subtitle1-font-family, inherit);
          font-size: var(--mdc-typography-subtitle1-font-size, 1rem);
          line-height: var(--mdc-typography-subtitle1-line-height, 1.75rem);
          box-sizing: border-box;
          outline: none;
          transition: border-bottom-color 0.15s ease;
          -webkit-appearance: none;
          -moz-appearance: textfield;
        `;

        // Create floating label for time field
        const timeLabel = document.createElement('span');
        timeLabel.textContent = 'Time';
        timeLabel.style.cssText = `
          position: absolute;
          left: 12px;
          top: 8px;
          font-size: 12px;
          color: ${fieldLabel};
          pointer-events: none;
          transition: all 0.2s ease;
        `;

        timeWrapper.appendChild(timeLabel);
        timeWrapper.appendChild(timeField);
        timeContainer.appendChild(timeWrapper);
        flexContainer.appendChild(timeContainer);
      }

      dueSection.appendChild(flexContainer);
      content.appendChild(dueSection);

      debugLog('Custom due date section added with native HA textfield styling');
    }

    // Add focus trap for better accessibility
    const setupFocusTrap = () => {
      const focusableElements = dialog.querySelectorAll(
        'ha-textfield, ha-checkbox, input, button, ha-button'
      );
      if (focusableElements.length === 0) return;

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      });
    };

    // Set up focus trap after dialog is added to DOM
    setTimeout(setupFocusTrap, 100);

    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 16px;
      padding-top: 26px;
    `;

    // Delete button (if item exists and supports delete)
    if (item && supportsDelete && this._config.show_item_delete !== false) {
      const deleteButton = this._createDeleteActionButton('Delete item');

      deleteButton.addEventListener('click', async () => {
        const confirmed =
          this._config.item_delete_confirmation === true
            ? await this.showDeleteConfirmationDialog(item.summary)
            : true;
        if (confirmed) {
          deleteTodoItemFromDialog(entityId, item, this._hass);
          this.closeDialog(dialog);
        }
      });

      footer.appendChild(deleteButton);
    }

    const actionSpacer = document.createElement('div');
    actionSpacer.style.flex = '1';
    footer.insertBefore(actionSpacer, footer.firstChild);

    // Save button
    const saveText = item ? 'Save item' : 'Add';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = saveText;
    saveButton.style.cssText = `
      min-width: 96px;
      min-height: 42px;
      border: 0;
      border-radius: 21px;
      padding: 0 20px;
      background: var(--accent-color, var(--primary-color));
      color: var(--text-primary-color, #fff);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    `;
    saveButton.addEventListener('click', async () => {
      const summary = summaryField.value.trim();
      if (!summary) {
        summaryField.reportValidity();
        return;
      }

      // Handle due date/time properly
      let dueValue = '';
      if (dateField?.value) {
        if (timeField?.value) {
          // Create a proper Date object and convert to ISO string
          const dateTimeString = `${dateField.value}T${timeField.value}:00`;
          try {
            const dateObj = new Date(dateTimeString);
            dueValue = dateObj.toISOString();
          } catch {
            console.error('Invalid date/time combination');
            dueValue = dateField.value; // fallback to date only
          }
        } else {
          // Date only
          dueValue = dateField.value;
        }
      }

      // Build data object conditionally based on entity support
      const data = {
        summary: summary,
        completed: checkbox?.checked || false
      };

      // Only include description if entity supports it
      if (supportsDescription) {
        data.description = descriptionField?.value;
      }

      // Only include dueDate if entity supports it
      if (supportsDueDate) {
        data.dueDate = dueValue;
      }

      const success = await this.handleDialogSave(entityId, item, data);

      if (success) {
        this.closeDialog(dialog);
      }
    });
    footer.appendChild(saveButton);
    content.appendChild(footer);
    dialog.appendChild(content);

    // Keyboard handlers
    summaryField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const summary = summaryField.value.trim();
        if (summary) {
          // Handle due date/time properly
          let dueValue = '';
          if (dateField?.value) {
            if (timeField?.value) {
              // Create a proper Date object and convert to ISO string
              const dateTimeString = `${dateField.value}T${timeField.value}:00`;
              try {
                const dateObj = new Date(dateTimeString);
                dueValue = dateObj.toISOString();
              } catch {
                console.error('Invalid date/time combination');
                dueValue = dateField.value; // fallback to date only
              }
            } else {
              // Date only
              dueValue = dateField.value;
            }
          }

          // Build data object conditionally based on entity support
          const data = {
            summary: summary,
            completed: checkbox?.checked || false
          };

          // Only include description if entity supports it
          if (supportsDescription) {
            data.description = descriptionField?.value;
          }

          // Only include dueDate if entity supports it
          if (supportsDueDate) {
            data.dueDate = dueValue;
          }

          this.handleDialogSave(entityId, item, data).then((success) => {
            if (success) this.closeDialog(dialog);
          });
        }
      }
    });

    // Handle dialog close
    dialog.addEventListener('closed', () => {
      this.onDialogClosed(dialog);
    });

    // Add to document and focus
    document.body.appendChild(dialog);

    // Focus after dialog is rendered
    setTimeout(() => {
      summaryField.focus();
    }, 100);
  }

  /**
   * Close a specific dialog.
   * @param {HTMLElement} dialog - Dialog to close
   */
  closeDialog(dialog) {
    if (dialog && dialog.open) {
      dialog.open = false;
      dialog.close();
    }
  }

  /**
   * Close the current dialog.
   */
  closeCurrentDialog() {
    if (this.currentDialog) {
      this.closeDialog(this.currentDialog);
      this.currentDialog = null;
    }
  }

  /**
   * Handle when a dialog is closed.
   * @param {HTMLElement} dialog - Closed dialog
   */
  onDialogClosed(dialog) {
    // Clean up the dialog from DOM
    if (dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }

    // Clear current dialog reference if this was the current one
    if (this.currentDialog === dialog) {
      this.currentDialog = null;
    }
  }

  /**
   * Handle saving from the dialog with error handling.
   * @param {string} entityId - Entity ID
   * @param {Object} item - Original item (null for new items)
   * @param {Object} data - Form data
   * @returns {Promise<boolean>} Success status
   */
  async handleDialogSave(entityId, item, data) {
    if (!data.summary) {
      return false;
    }

    try {
      if (item) {
        await updateTodoItemFromDialog(entityId, item, data, this._hass);
      } else {
        await addTodoItemFromDialog(entityId, data, this._hass);
      }
      return true;
    } catch (error) {
      debugLog('Error saving todo item:', error);
      return false;
    }
  }

  /**
   * Show delete confirmation dialog.
   * @param {string} itemSummary - Item summary for confirmation
   * @returns {Promise<boolean>} True if confirmed
   */
  async showDeleteConfirmationDialog(itemSummary) {
    return new Promise((resolve) => {
      const confirmDialog = document.createElement('ha-dialog');
      confirmDialog.heading = '';
      confirmDialog.open = true;
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        this.closeDialog(confirmDialog);
      };

      const content = document.createElement('div');
      content.style.cssText = `
        padding: 16px 24px 8px 24px;
        color: var(--primary-text-color);
      `;

      const message = document.createElement('div');
      message.textContent = `Are you sure you want to delete "${itemSummary}"?`;
      message.style.cssText = `
        font-size: 16px;
        line-height: 24px;
      `;
      content.appendChild(message);

      const footer = document.createElement('div');
      footer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 16px;
        padding-top: 24px;
      `;

      // Cancel button first (secondary action)
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = `
        border: 0;
        background: transparent;
        color: var(--primary-color);
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        padding: 8px 0;
      `;
      cancelButton.addEventListener('click', () => {
        finish(false);
      });

      // Delete button with red styling
      const confirmButton = this._createDeleteActionButton('Delete');
      confirmButton.addEventListener('click', () => {
        finish(true);
      });

      [cancelButton, confirmButton].forEach((button) => {
        button.addEventListener('pointerdown', (e) => e.stopPropagation());
        button.addEventListener('mousedown', (e) => e.stopPropagation());
        button.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      });

      footer.appendChild(cancelButton);
      footer.appendChild(confirmButton);
      content.appendChild(footer);
      confirmDialog.appendChild(content);

      confirmDialog.addEventListener('closed', () => {
        if (confirmDialog.parentNode) {
          confirmDialog.parentNode.removeChild(confirmDialog);
        }
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      document.body.appendChild(confirmDialog);
    });
  }

  /**
   * Show delete confirmation dialog for delete completed items.
   * @param {string} entityId - Entity ID for the todo list
   */
  showDeleteCompletedConfirmation(entityId) {
    // Create confirmation dialog
    const dialog = document.createElement('ha-dialog');
    dialog.heading = '';
    dialog.open = true;
    let closed = false;
    const closeDialog = () => {
      if (closed) return;
      closed = true;
      this.closeDialog(dialog);
    };

    // Create content container
    const content = document.createElement('div');
    content.style.cssText = `
      padding: 16px 24px 8px 24px;
      color: var(--primary-text-color);
    `;

    const title = document.createElement('div');
    title.textContent = 'Remove completed items?';
    title.style.cssText = `
      font-size: 20px;
      font-weight: 700;
      line-height: 28px;
      margin-bottom: 18px;
    `;

    const message = document.createElement('div');
    message.textContent =
      'Completed items will be permanently removed from the to-do list.';
    message.style.cssText = `
      font-size: 16px;
      line-height: 24px;
    `;

    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 16px;
      padding-top: 32px;
    `;

    content.appendChild(title);
    content.appendChild(message);

    // Create cancel button first (secondary action)
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.style.cssText = `
      border: 0;
      background: transparent;
      color: var(--primary-color);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      padding: 8px 0;
    `;
    cancelButton.addEventListener('click', () => {
      closeDialog();
    });

    // Create confirm button with red styling
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = 'Delete';
    confirmButton.style.cssText = `
      min-width: 76px;
      min-height: 42px;
      border: 0;
      border-radius: 21px;
      padding: 0 20px;
      background: var(--error-color, #db005b);
      color: var(--text-primary-color, #fff);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    `;
    confirmButton.addEventListener('click', () => {
      deleteCompletedItems(entityId, this._hass);
      closeDialog();
    });

    [cancelButton, confirmButton].forEach((button) => {
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('mousedown', (e) => e.stopPropagation());
      button.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    });

    // Append buttons to dialog
    footer.appendChild(cancelButton);
    footer.appendChild(confirmButton);
    content.appendChild(footer);
    dialog.appendChild(content);

    // Handle dialog close
    dialog.addEventListener('closed', () => {
      if (dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
    });

    // Add dialog to document
    document.body.appendChild(dialog);
  }
}
