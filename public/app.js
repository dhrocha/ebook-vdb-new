(function () {
  const form = document.getElementById("lead-form");
  const submitBtn = document.getElementById("submit-btn");
  const messageEl = document.getElementById("form-message");
  const defaultLabel = submitBtn.textContent;

  function showMessage(text, type) {
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.remove("is-error", "is-success");
    messageEl.classList.add(type === "error" ? "is-error" : "is-success");
  }

  function clearMessage() {
    messageEl.hidden = true;
    messageEl.textContent = "";
    messageEl.classList.remove("is-error", "is-success");
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.textContent = loading ? "Preparando download..." : defaultLabel;
  }

  function openExternalDownload(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.download = "guia-completo-vestidas-de-branco.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function triggerDownload(url, external) {
    const isExternal = external || /^https?:\/\//i.test(url);

    // Vercel / Drive: não dá para proxyar ~95MB na function — abre o download direto
    if (isExternal) {
      openExternalDownload(url);
      return;
    }

    try {
      const fileRes = await fetch(url, { credentials: "same-origin" });
      if (!fileRes.ok) throw new Error("Falha no download");

      const blob = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "guia-completo-vestidas-de-branco.pdf";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 2000);
    } catch (_err) {
      window.location.href = url;
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearMessage();

    const nameInput = form.elements.namedItem("name");
    const emailInput = form.elements.namedItem("email");
    const whatsappInput = form.elements.namedItem("whatsapp");

    [nameInput, emailInput, whatsappInput].forEach(function (el) {
      el.classList.remove("is-invalid");
    });

    const payload = {
      name: String(nameInput.value || "").trim(),
      email: String(emailInput.value || "").trim(),
      whatsapp: String(whatsappInput.value || "").trim(),
    };

    let hasError = false;
    if (!payload.name) {
      nameInput.classList.add("is-invalid");
      hasError = true;
    }
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      emailInput.classList.add("is-invalid");
      hasError = true;
    }
    if (!payload.whatsapp || payload.whatsapp.replace(/\D/g, "").length < 8) {
      whatsappInput.classList.add("is-invalid");
      hasError = true;
    }

    if (hasError) {
      showMessage("Preencha os campos corretamente para baixar o guia.", "error");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(function () {
        return { ok: false, error: "Resposta inválida do servidor." };
      });

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Não foi possível enviar seus dados.");
      }

      await triggerDownload(data.downloadUrl || "/api/download", data.external);
      showMessage("Pronto! O download do guia deve começar agora.", "success");
      form.reset();
    } catch (err) {
      showMessage(err.message || "Algo deu errado. Tente novamente.", "error");
    } finally {
      setLoading(false);
    }
  });
})();
