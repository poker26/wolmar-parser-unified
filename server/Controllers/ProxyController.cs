using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Collections.Generic;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public ProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("load")]
        public async Task<IActionResult> LoadUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Отправляем команду в Chrome через DevTools Protocol
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url,
                        waitUntil = "networkidle2"
                    }
                };

                var json = JsonSerializer.Serialize(navigateCommand);
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");

                // Отправляем команду в Chrome
                var response = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/runtime/evaluate", content);
                
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode(500, "Failed to communicate with Chrome");
                }

                // Ждем загрузки страницы
                await Task.Delay(3000);

                // Получаем HTML содержимое
                var htmlCommand = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var htmlJson = JsonSerializer.Serialize(htmlCommand);
                var htmlContent = new StringContent(htmlJson, System.Text.Encoding.UTF8, "application/json");

                var htmlResponse = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/runtime/evaluate", htmlContent);
                var htmlResult = await htmlResponse.Content.ReadAsStringAsync();

                var result = JsonSerializer.Deserialize<dynamic>(htmlResult);
                var html = result.result.value.ToString();

                // Проверяем на Cloudflare
                if (html.Contains("Just a moment") || html.Contains("Один момент") || html.Contains("Cloudflare"))
                {
                    return Ok(new
                    {
                        success = false,
                        message = "Cloudflare challenge detected",
                        html = html
                    });
                }

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = html,
                    timestamp = System.DateTime.UtcNow
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }

        [HttpGet("status")]
        public async Task<IActionResult> GetStatus()
        {
            try
            {
                // Проверяем статус Chrome
                var response = await _httpClient.GetAsync($"{_chromeDebugUrl}/json/version");
                
                if (response.IsSuccessStatusCode)
                {
                    var content = await response.Content.ReadAsStringAsync();
                    var version = JsonSerializer.Deserialize<dynamic>(content);
                    
                    return Ok(new
                    {
                        status = "connected",
                        chrome = version,
                        timestamp = System.DateTime.UtcNow
                    });
                }
                else
                {
                    return Ok(new
                    {
                        status = "disconnected",
                        message = "Chrome not available",
                        timestamp = System.DateTime.UtcNow
                    });
                }
            }
            catch (System.Exception ex)
            {
                return Ok(new
                {
                    status = "error",
                    error = ex.Message,
                    timestamp = System.DateTime.UtcNow
                });
            }
        }

        [HttpPost("execute")]
        public async Task<IActionResult> ExecuteScript([FromBody] ExecuteScriptRequest request)
        {
            try
            {
                var command = new
                {
                    id = 3,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = request.Script,
                        returnByValue = true
                    }
                };

                var json = JsonSerializer.Serialize(command);
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");

                var response = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/runtime/evaluate", content);
                var result = await response.Content.ReadAsStringAsync();

                return Ok(new
                {
                    success = true,
                    result = result,
                    timestamp = System.DateTime.UtcNow
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }

    public class ExecuteScriptRequest
    {
        public string Script { get; set; }
    }
}
